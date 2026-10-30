import { Router } from 'express'
import rateLimit from 'express-rate-limit'
import { z } from 'zod'
import { eraseUser, purgeTenant } from '../account-deletion.js'
import {
  clearedCookie,
  createSession,
  destroySession,
  dummyVerify,
  hashPassword,
  recentSocialLogin,
  requireAuth,
  sessionCookie,
  slugify,
  verifyPassword,
} from '../auth.js'
import { UNIQUE_VIOLATION } from '../db/index.js'
import { HttpError, parse } from '../http.js'

const email = z.string().trim().toLowerCase().email().max(254)
const password = z.string().min(8).max(200)

const registerBody = z.object({
  email,
  password,
  name: z.string().trim().min(1).max(120),
  businessName: z.string().trim().min(1).max(120),
  locale: z.enum(['ar', 'en']).default('ar'),
})
const loginBody = z.object({ email, password: z.string().min(1).max(200) })

export function me(auth) {
  return { user: auth.user, tenant: auth.tenant, role: auth.role, recentSocialLogin: recentSocialLogin(auth), socialProviders: auth.socialProviders || [] }
}

export default function authRoutes({ db, config, billing, wallet }) {
  const r = Router()
  const limiter = rateLimit({
    windowMs: 60_000,
    limit: config.authRateLimit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: (_req, res) => res.status(429).json({ error: 'rate_limited' }),
  })

  /* Browsers get an HttpOnly cookie. The native app (x-mp-client: mobile) gets the
     token in the body instead and sends it as a bearer header — cookies do not
     survive a cross-origin Capacitor webview. */
  async function startSession(req, res, userId, tenantId) {
    const token = await createSession(db, { userId, tenantId, userAgent: req.get('user-agent'), ttlDays: config.sessionTtlDays })
    if (req.get('x-mp-client') === 'mobile') return { token }
    res.setHeader('Set-Cookie', sessionCookie(token, { production: config.production, ttlDays: config.sessionTtlDays }))
    return {}
  }

  r.post('/register', limiter, async (req, res) => {
    const body = parse(registerBody, req.body)
    const passwordHash = await hashPassword(body.password)
    let ids
    try {
      ids = await db.tx(async (tx) => {
        const {
          rows: [user],
        } = await tx.query('INSERT INTO users (email, password_hash, name, locale) VALUES ($1, $2, $3, $4) RETURNING id', [
          body.email,
          passwordHash,
          body.name,
          body.locale,
        ])
        const {
          rows: [tenant],
        } = await tx.query('INSERT INTO tenants (name, slug) VALUES ($1, $2) RETURNING id, slug', [body.businessName, slugify(body.businessName)])
        await tx.query("INSERT INTO memberships (tenant_id, user_id, role) VALUES ($1, $2, 'owner')", [tenant.id, user.id])
        await tx.query("INSERT INTO audit_log (tenant_id, actor_user_id, action) VALUES ($1, $2, 'tenant.created')", [tenant.id, user.id])
        return { userId: user.id, tenantId: tenant.id, slug: tenant.slug }
      })
    } catch (err) {
      if (err.code === UNIQUE_VIOLATION) throw new HttpError(409, 'email_taken')
      throw err
    }
    const extra = await startSession(req, res, ids.userId, ids.tenantId)
    res.status(201).json({
      user: { id: ids.userId, email: body.email, name: body.name, locale: body.locale },
      tenant: { id: ids.tenantId, name: body.businessName, slug: ids.slug },
      role: 'owner',
      ...extra,
    })
  })

  r.post('/login', limiter, async (req, res) => {
    const body = parse(loginBody, req.body)
    const {
      rows: [user],
    } = await db.query('SELECT id, email, name, locale, password_hash FROM users WHERE lower(email) = $1', [body.email])
    if (!user) {
      await dummyVerify(body.password)
      throw new HttpError(401, 'invalid_credentials')
    }
    if (!(await verifyPassword(body.password, user.password_hash))) throw new HttpError(401, 'invalid_credentials')
    const {
      rows: [membership],
    } = await db.query(
      `SELECT m.tenant_id, m.role, t.name, t.slug FROM memberships m JOIN tenants t ON t.id = m.tenant_id
        WHERE m.user_id = $1 AND t.closed_at IS NULL ORDER BY m.created_at LIMIT 1`,
      [user.id],
    )
    if (!membership) throw new HttpError(403, 'no_workspace')
    const extra = await startSession(req, res, user.id, membership.tenant_id)
    res.json({
      user: { id: user.id, email: user.email, name: user.name, locale: user.locale },
      tenant: { id: membership.tenant_id, name: membership.name, slug: membership.slug },
      role: membership.role,
      ...extra,
    })
  })

  r.post('/logout', async (req, res) => {
    await destroySession(db, req.auth?.token)
    res.setHeader('Set-Cookie', clearedCookie({ production: config.production }))
    res.json({ ok: true })
  })

  r.get('/me', requireAuth, (req, res) => res.json(me(req.auth)))

  /* Account deletion (App Store 5.1.1(v), Google Play account deletion; explained publicly at
     /delete-account). Requires the password or a recent server-verified social login.
     The login is erased. Every workspace this user alone owns is closed (staff lose
     access at once) and purged right away; only billing records are kept, for the
     legal retention period (see account-deletion.js). */
  r.post('/delete-account', requireAuth, limiter, async (req, res) => {
    const { password: pw, socialConfirmation } = parse(
      z.object({ password: z.string().min(1).max(200).optional(), socialConfirmation: z.literal(true).optional() }),
      req.body,
    )
    if (socialConfirmation) {
      if (!recentSocialLogin(req.auth)) throw new HttpError(401, 'social_reauth_required')
    } else {
      const {
        rows: [user],
      } = await db.query('SELECT password_hash FROM users WHERE id = $1', [req.auth.userId])
      if (!pw || !user || !(await verifyPassword(pw, user.password_hash))) throw new HttpError(401, 'invalid_credentials')
    }
    const closed = await db.tx(async (tx) => {
      // Workspaces where this user is the only owner.
      const { rows: owned } = await tx.query(
        `SELECT m.tenant_id FROM memberships m WHERE m.user_id = $1 AND m.role = 'owner'
            AND NOT EXISTS (SELECT 1 FROM memberships o WHERE o.tenant_id = m.tenant_id AND o.role = 'owner' AND o.user_id <> m.user_id)`,
        [req.auth.userId],
      )
      for (const { tenant_id } of owned) {
        await tx.query('UPDATE tenants SET closed_at = now(), purge_after = now() WHERE id = $1', [tenant_id])
        await tx.query('DELETE FROM sessions WHERE tenant_id = $1', [tenant_id])
        await tx.query("INSERT INTO audit_log (tenant_id, action) VALUES ($1, 'tenant.closed_by_owner_deletion')", [tenant_id])
      }
      await eraseUser(tx, req.auth.userId)
      return owned.map((o) => o.tenant_id)
    })
    for (const tenantId of closed) {
      // No renewal charges after deletion (unified billing keeps its own invoices). Best effort.
      if (billing?.remote && billing.ready) billing.cancel(tenantId).catch(() => {})
      // The hourly sweep retries a purge that fails here.
      await purgeTenant(db, tenantId, { wallet }).catch((err) => console.warn(`[deletion] purge of ${tenantId} deferred: ${err.message}`))
    }
    res.setHeader('Set-Cookie', clearedCookie({ production: config.production }))
    res.json({ ok: true, workspaceDeleted: closed.length > 0 })
  })

  return r
}
