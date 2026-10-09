import { Router } from 'express'
import rateLimit from 'express-rate-limit'
import { z } from 'zod'
import { clearedCookie, createSession, destroySession, dummyVerify, hashPassword, requireAuth, sessionCookie, slugify, verifyPassword } from '../auth.js'
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
  return { user: auth.user, tenant: auth.tenant, role: auth.role }
}

export default function authRoutes({ db, config }) {
  const r = Router()
  const limiter = rateLimit({
    windowMs: 60_000,
    limit: config.authRateLimit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: (_req, res) => res.status(429).json({ error: 'rate_limited' }),
  })

  async function startSession(req, res, userId, tenantId) {
    const token = await createSession(db, { userId, tenantId, userAgent: req.get('user-agent'), ttlDays: config.sessionTtlDays })
    res.setHeader('Set-Cookie', sessionCookie(token, { production: config.production, ttlDays: config.sessionTtlDays }))
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
        } = await tx.query('INSERT INTO tenants (name, slug) VALUES ($1, $2) RETURNING id', [body.businessName, slugify(body.businessName)])
        await tx.query("INSERT INTO memberships (tenant_id, user_id, role) VALUES ($1, $2, 'owner')", [tenant.id, user.id])
        await tx.query("INSERT INTO audit_log (tenant_id, actor_user_id, action) VALUES ($1, $2, 'tenant.created')", [tenant.id, user.id])
        return { userId: user.id, tenantId: tenant.id }
      })
    } catch (err) {
      if (err.code === UNIQUE_VIOLATION) throw new HttpError(409, 'email_taken')
      throw err
    }
    await startSession(req, res, ids.userId, ids.tenantId)
    res.status(201).json({
      user: { id: ids.userId, email: body.email, name: body.name, locale: body.locale },
      tenant: { id: ids.tenantId, name: body.businessName },
      role: 'owner',
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
        WHERE m.user_id = $1 ORDER BY m.created_at LIMIT 1`,
      [user.id],
    )
    if (!membership) throw new HttpError(403, 'no_workspace')
    await startSession(req, res, user.id, membership.tenant_id)
    res.json({
      user: { id: user.id, email: user.email, name: user.name, locale: user.locale },
      tenant: { id: membership.tenant_id, name: membership.name, slug: membership.slug },
      role: membership.role,
    })
  })

  r.post('/logout', async (req, res) => {
    await destroySession(db, req.auth?.token)
    res.setHeader('Set-Cookie', clearedCookie({ production: config.production }))
    res.json({ ok: true })
  })

  r.get('/me', requireAuth, (req, res) => res.json(me(req.auth)))

  return r
}
