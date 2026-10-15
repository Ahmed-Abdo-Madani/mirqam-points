import rateLimit from 'express-rate-limit'
import { createSession, requireAuth, sessionCookie } from './auth.js'
import { HttpError } from './http.js'

const AUD = 'https://loyalty.mirqam.sa'
const HQ = 'https://mirqam.sa/m/ad0ed94a6a279f02a1295ae283efa07d2c18/bridge/consume'
export function installHqAdmin(app, { db, config, wallet, request = fetch }) {
  const limiter = rateLimit({
    windowMs: 60000,
    limit: 20,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: (_req, res) => res.status(429).json({ error: 'rate_limited' }),
  })
  const headers = (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('Referrer-Policy', 'no-referrer')
    res.setHeader('X-Robots-Tag', 'noindex, nofollow')
    next()
  }
  app.post('/api/hq-entry', headers, limiter, async (req, res) => {
    if (req.get('host') !== 'loyalty.mirqam.sa' || req.get('origin') !== AUD) throw new HttpError(403, 'forbidden')
    const code = req.body?.code
    if (typeof code !== 'string' || !/^[a-f0-9]{64}$/.test(code)) throw new HttpError(401, 'unauthenticated')
    const { rows } = await db.query(
      "SELECT a.* FROM hq_admin_access a JOIN tenants t ON t.id=a.tenant_id JOIN memberships m ON m.tenant_id=a.tenant_id AND m.user_id=a.user_id WHERE a.enabled AND t.closed_at IS NULL AND m.role='owner'",
    )
    if (rows.length !== 1) throw new HttpError(403, 'forbidden')
    const c = rows[0]
    let r
    try {
      r = await request(HQ, {
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.timeout(8000),
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + c.bridge_key },
        body: JSON.stringify({ platform: 'loyalty', code }),
      })
    } catch {
      throw new HttpError(503, 'http_error')
    }
    if (!r.ok) throw new HttpError(401, 'unauthenticated')
    const grant = await r.json()
    if (grant?.userId !== c.user_id || grant?.audience !== AUD || grant?.role !== 'superadmin') throw new HttpError(403, 'forbidden')
    const token = await db.tx(async (tx) => {
      const { rows: valid } = await tx.query(
        "SELECT a.user_id FROM hq_admin_access a JOIN tenants t ON t.id=a.tenant_id JOIN memberships m ON m.tenant_id=a.tenant_id AND m.user_id=a.user_id WHERE a.user_id=$1 AND a.tenant_id=$2 AND a.enabled AND t.closed_at IS NULL AND m.role='owner' FOR UPDATE OF a",
        [c.user_id, c.tenant_id],
      )
      if (valid.length !== 1) throw new HttpError(403, 'forbidden')
      const token = await createSession(tx, { userId: c.user_id, tenantId: c.tenant_id, userAgent: req.get('user-agent'), ttlDays: 1 })
      await tx.query("INSERT INTO audit_log(tenant_id,actor_user_id,action) VALUES($1,$2,'hq.sso.login')", [c.tenant_id, c.user_id])
      return token
    })
    res.setHeader('Set-Cookie', sessionCookie(token, { production: config.production, ttlDays: 1 }))
    res.json({ ok: true })
  })
  app.get('/api/hq-admin', headers, requireAuth, async (req, res) => {
    const { rows: grants } = await db.query('SELECT 1 FROM hq_admin_access WHERE tenant_id=$1 AND user_id=$2 AND enabled', [req.auth.tenantId, req.auth.userId])
    if (grants.length !== 1 || req.auth.role !== 'owner') throw new HttpError(403, 'forbidden')
    const { rows: tenants } = await db.query(
      'SELECT t.id,t.name,t.slug,t.created_at,t.closed_at,s.cycle,s.expires_at,(SELECT count(*)::int FROM programs p WHERE p.tenant_id=t.id) AS programs,(SELECT count(*)::int FROM members m WHERE m.tenant_id=t.id) AS members FROM tenants t LEFT JOIN subscriptions s ON s.tenant_id=t.id WHERE NOT EXISTS(SELECT 1 FROM hq_admin_access a WHERE a.tenant_id=t.id) ORDER BY t.created_at DESC',
    )
    const {
      rows: [paid],
    } = await db.query(
      "SELECT count(*)::int AS count,COALESCE(sum(amount),0)::bigint AS amount FROM subscription_checkouts c WHERE status='paid' AND NOT EXISTS(SELECT 1 FROM hq_admin_access a WHERE a.tenant_id=c.tenant_id)",
    )
    res.json({ asOf: new Date().toISOString(), tenants, paid: { count: paid.count, amount: String(paid.amount) }, wallet: wallet.status() })
  })
}
