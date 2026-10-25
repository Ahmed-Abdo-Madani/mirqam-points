import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { hashPassword, slugify } from '../auth.js'
import { HttpError } from '../http.js'

/* Loyalty built into the Mirqam POS console.
 *
 * POST /api/pos/native/ensure — server to server from the Mirqam API
 * (Authorization: Bearer MIRQAM_POS_BRIDGE_KEY). Finds or creates the loyalty
 * workspace behind a POS tenant, mints its link credential once, and keeps a
 * POS-created workspace on the POS subscription (managed_until).
 *
 * The POS server then calls the ordinary loyalty API with
 * `Authorization: PosLink <id>.<secret>` (posLinkAuth below), acting as the
 * workspace owner on the merchant-console paths only. The same secret is the
 * link's loyaltyAccess, so the till's points earn/redeem works with no extra
 * step. An existing consent link (app store) is reused and keeps its own
 * subscription.
 */
const digest = (s) => createHash('sha256').update(String(s)).digest('base64url')
const random = () => randomBytes(32).toString('base64url')
const valid = (s) => typeof s === 'string' && /^[A-Za-z0-9_-]{43}$/.test(s)
const safe = (a, b) => typeof a === 'string' && typeof b === 'string' && a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b))

/** Merchant-console API reachable with a link credential (prefix match on path segments). */
export const POS_LINK_PATHS = [
  ['GET', '/api/auth/me'],
  ['GET', '/api/wallet/status'],
  ['*', '/api/programs'],
  ['*', '/api/members'],
  ['*', '/api/ledger'],
  ['*', '/api/campaigns'],
  ['*', '/api/gift-cards'],
]

function pathAllowed(method, path) {
  return POS_LINK_PATHS.some(([m, prefix]) => (m === '*' || m === method) && (path === prefix || path.startsWith(`${prefix}/`)))
}

/** Runs after loadSession: a request with no session but a link credential becomes the workspace owner. */
export function posLinkAuth(db) {
  return async (req, _res, next) => {
    try {
      const m = /^PosLink ([A-Za-z0-9_-]{43})\.([A-Za-z0-9_-]{43})$/.exec(req.get('authorization') || '')
      if (!m || req.auth) return next()
      const path = (req.originalUrl || req.url).split('?')[0]
      if (!pathAllowed(req.method, path)) throw new HttpError(403, 'pos_link_path_denied')
      const link = (await db.query('SELECT tenant_id, data FROM pos_account_links WHERE key=$1', [`link:${m[1]}`])).rows[0]
      if (!link?.data?.active || !safe(link.data.revokeHash, digest(m[2]))) throw new HttpError(401, 'unauthenticated')
      const row = (
        await db.query(
          `SELECT u.id AS user_id, u.email, u.name AS user_name, u.locale, t.id AS tenant_id, t.name AS tenant_name, t.slug, t.logo_version
             FROM tenants t
             JOIN memberships ms ON ms.tenant_id = t.id AND ms.role = 'owner'
             JOIN users u ON u.id = ms.user_id
            WHERE t.id = $1 AND t.closed_at IS NULL
            ORDER BY ms.created_at NULLS LAST
            LIMIT 1`,
          [link.tenant_id],
        )
      ).rows[0]
      if (!row) throw new HttpError(401, 'unauthenticated')
      req.auth = {
        token: null,
        via: 'pos-link',
        userId: row.user_id,
        tenantId: row.tenant_id,
        role: 'owner',
        socialAuthenticatedAt: null,
        socialProviders: [],
        user: { id: row.user_id, email: row.email, name: row.user_name, locale: row.locale },
        tenant: {
          id: row.tenant_id,
          name: row.tenant_name,
          slug: row.slug,
          logoUrl: row.logo_version ? `/api/public/logo/${row.slug}?v=${row.logo_version}` : null,
        },
      }
      next()
    } catch (err) {
      next(err)
    }
  }
}

export function installPosNative({ app, db, env = process.env }) {
  // Any long random value works (hex, base64…); whitespace from a paste is ignored.
  const key = (env.MIRQAM_POS_BRIDGE_KEY || '').trim()
  const enabled = key.length >= 32 && !/\s/.test(key)
  const gate = (req, res, next) => {
    res.set('Cache-Control', 'no-store')
    if (!enabled) return res.status(503).json({ error: 'bridge_disabled' })
    const got = String(req.get('authorization') || '').replace(/^Bearer\s+/i, '')
    if (!safe(got, key)) return res.status(401).json({ error: 'unauthorized' })
    next()
  }
  const until = (v) => (v && Date.parse(v) > 0 ? new Date(v) : new Date(Date.now() + 365 * 86400000))

  app.post('/api/pos/native/ensure', gate, async (req, res, next) => {
    try {
      const { linkId, posTenant, subject, tenantName, email, ownerName, managedUntil } = req.body ?? {}
      if (typeof posTenant !== 'string' || !posTenant || posTenant.length > 120 || typeof subject !== 'string' || subject.length > 240)
        throw new HttpError(400, 'invalid_request')
      // 1. The POS tenant already holds a link (native or consent): keep using it.
      if (linkId !== undefined && linkId !== null) {
        if (!valid(linkId)) throw new HttpError(400, 'invalid_request')
        const link = (await db.query('SELECT tenant_id, data FROM pos_account_links WHERE key=$1', [`link:${linkId}`])).rows[0]
        if (!link?.data?.active || link.data.posTenant !== posTenant) throw new HttpError(404, 'link_not_found')
        await db.query('UPDATE pos_native_tenants SET managed_until=$2, updated_at=now() WHERE tenant_id=$1', [link.tenant_id, until(managedUntil)])
        const t = (await db.query('SELECT name, closed_at FROM tenants WHERE id=$1', [link.tenant_id])).rows[0]
        if (!t || t.closed_at) throw new HttpError(403, 'account_closed')
        const managed = (await db.query('SELECT 1 FROM pos_native_tenants WHERE tenant_id=$1', [link.tenant_id])).rows.length > 0
        return res.json({ id: linkId, accountName: t.name, managed })
      }
      // 2. This POS tenant's own workspace, or create it.
      const result = await db.tx(async (tx) => {
        await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`pos-native:${posTenant}`])
        let row = (await tx.query('SELECT tenant_id, user_id FROM pos_native_tenants WHERE pos_tenant=$1', [posTenant])).rows[0]
        if (!row) {
          const installed = (await tx.query('SELECT tenant_id, user_id FROM pos_provisioned_accounts WHERE subject=$1', [subject])).rows[0]
          if (installed) row = installed
          else {
            const wanted = typeof email === 'string' && /^\S+@\S+\.\S+$/.test(email) && email.length <= 254 ? email.trim().toLowerCase() : ''
            // An owner with an existing loyalty account links it by consent from
            // the POS app store; a POS tenant never takes over an account by email.
            const taken = wanted ? (await tx.query('SELECT 1 FROM users WHERE lower(email)=$1', [wanted])).rows.length > 0 : true
            const address = taken ? `pos-${digest(posTenant).slice(0, 20).toLowerCase()}@pos.mirqam.sa` : wanted
            const name = String(tenantName || '').slice(0, 120) || 'منشأة مرقام'
            const user = (
              await tx.query("INSERT INTO users(email,password_hash,name,locale) VALUES($1,$2,$3,'ar') RETURNING id", [
                address,
                await hashPassword(randomBytes(48).toString('hex')),
                String(ownerName || name).slice(0, 120),
              ])
            ).rows[0]
            const tenant = (await tx.query('INSERT INTO tenants(name,slug) VALUES($1,$2) RETURNING id', [name, slugify(name)])).rows[0]
            await tx.query("INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,'owner')", [tenant.id, user.id])
            await tx.query("INSERT INTO audit_log(tenant_id,actor_user_id,action) VALUES($1,$2,'tenant.created')", [tenant.id, user.id])
            row = { tenant_id: tenant.id, user_id: user.id }
          }
          await tx.query(
            'INSERT INTO pos_native_tenants(pos_tenant,tenant_id,user_id,managed_until) VALUES($1,$2,$3,$4) ON CONFLICT (tenant_id) DO UPDATE SET pos_tenant=EXCLUDED.pos_tenant, managed_until=EXCLUDED.managed_until, updated_at=now()',
            [posTenant, row.tenant_id, row.user_id, until(managedUntil)],
          )
        } else {
          await tx.query('UPDATE pos_native_tenants SET managed_until=$2, updated_at=now() WHERE pos_tenant=$1', [posTenant, until(managedUntil)])
        }
        const t = (await tx.query('SELECT name, closed_at FROM tenants WHERE id=$1', [row.tenant_id])).rows[0]
        if (!t || t.closed_at) throw new HttpError(403, 'account_closed')
        const id = random()
        const secret = random()
        await tx.query('INSERT INTO pos_account_links(key,tenant_id,data) VALUES($1,$2,$3)', [
          `link:${id}`,
          row.tenant_id,
          {
            id,
            identity: { id: row.tenant_id, name: t.name },
            posTenant,
            revokeHash: digest(secret),
            loyaltyAccessHash: digest(secret),
            createdAt: Date.now(),
            active: true,
            native: true,
          },
        ])
        return { id, secret, accountName: t.name }
      })
      res.json({ ...result, managed: true })
    } catch (err) {
      next(err)
    }
  })
  return { enabled }
}

/** POS-managed workspaces follow the POS subscription. Null when not POS-managed. */
export async function posManagedEntitlement(db, tenantId, now = new Date()) {
  const row = (await db.query('SELECT managed_until FROM pos_native_tenants WHERE tenant_id=$1', [tenantId])).rows[0]
  if (!row) return null
  const expiresAt = row.managed_until ? new Date(row.managed_until) : null
  if (!expiresAt || expiresAt <= now) return { state: 'expired', allowed: false, expiresAt, cycle: 'yearly', daysLeft: 0, managedBy: 'mirqam-pos' }
  return { state: 'active', allowed: true, expiresAt, cycle: 'yearly', daysLeft: Math.ceil((expiresAt - now) / 86400000), managedBy: 'mirqam-pos' }
}
