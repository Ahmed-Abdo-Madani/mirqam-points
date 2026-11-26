import rateLimit from 'express-rate-limit'
import { z } from 'zod'
import { createSession, requireAuth, sessionCookie } from './auth.js'
import { int } from './db/index.js'
import { HttpError, id, pageQuery, parse } from './http.js'

const AUD = 'https://loyalty.mirqam.sa'
const HQ = 'https://mirqam.sa/m/ad0ed94a6a279f02a1295ae283efa07d2c18/bridge/consume'
const CACHE_MS = 60_000
/* A tenant is a merchant unless it is an HQ workspace (any grant row, enabled or not). */
const merchant = (col) => `NOT EXISTS (SELECT 1 FROM hq_admin_access h WHERE h.tenant_id = ${col})`
/* Mirrors billing.entitlement for t/s/n = tenants/subscriptions/pos_native_tenants, with
   $1 = trial days and $2 = remote billing. POS management comes first for local billing only
   (the remote client ignores it); a lapsed POS workspace is 'expired', as entitlement() says. */
const ENTITLEMENT = `CASE
    WHEN NOT $2::boolean AND n.tenant_id IS NOT NULL THEN CASE WHEN n.managed_until > now() THEN 'posManaged' ELSE 'expired' END
    WHEN s.tenant_id IS NOT NULL THEN CASE
      WHEN s.expires_at <= now() THEN 'expired'
      WHEN ($2::boolean AND s.status = 'past_due') OR s.expires_at <= now() + interval '7 days' THEN 'expiring'
      ELSE 'active' END
    WHEN t.created_at + $1::float8 * interval '1 day' > now() THEN 'trial'
    ELSE 'none' END`
const STATES = ['posManaged', 'active', 'expiring', 'trial', 'expired', 'none']
const ENTITLED = new Set(['posManaged', 'active', 'expiring', 'trial'])
const listQuery = pageQuery.extend({ q: z.string().trim().max(80).optional() })
const likeTerm = (q) => (q ? `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null)

const mapEntitlement = (e) =>
  e
    ? {
        available: true,
        state: e.state,
        allowed: Boolean(e.allowed),
        daysLeft: e.daysLeft ?? null,
        expiresAt: e.expiresAt ?? null,
        trialEndsAt: e.trialEndsAt ?? null,
        cycle: e.cycle ?? null,
        managedBy: e.managedBy ?? null,
        billingStatus: e.billingStatus ?? null,
      }
    : { available: false }

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
  /* Every HQ route: an enabled grant for this exact (workspace, user), as the owner, re-checked
     on each request so revoking the grant takes effect immediately. */
  const requireHq = [
    headers,
    requireAuth,
    async (req, _res, next) => {
      const { rows } = await db.query('SELECT 1 FROM hq_admin_access WHERE tenant_id=$1 AND user_id=$2 AND enabled', [req.auth.tenantId, req.auth.userId])
      if (rows.length !== 1 || req.auth.role !== 'owner') throw new HttpError(403, 'forbidden')
      next()
    },
  ]
  // app.locals.billing is set by createApp before this runs; bare test apps may not have one.
  const billing = () => app.locals.billing
  const remote = () => Boolean(billing()?.remote)
  const trialDays = () => (Number.isFinite(config.trialDays) ? config.trialDays : 14)

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

  /* Platform-wide aggregates scan whole tables. Each KPI group runs in its own short read
     transaction: one that is too slow is reported as unavailable (null), never as 0. */
  async function bounded(sql, params = []) {
    try {
      return await db.tx(async (tx) => {
        await tx.query("SET LOCAL statement_timeout = '5s'")
        return (await tx.query(sql, params)).rows
      })
    } catch (err) {
      console.warn('[hq] KPI query failed:', err.message)
      return null
    }
  }

  async function overview() {
    const asOf = new Date().toISOString()
    const isRemote = remote()
    const merchants = await bounded(
      `SELECT count(*)::int AS open,
              count(*) FILTER (WHERE t.created_at > now() - interval '30 days')::int AS new_30d,
              count(*) FILTER (WHERE EXISTS (SELECT 1 FROM ledger_entries e WHERE e.tenant_id = t.id AND e.created_at > now() - interval '30 days'))::int AS transacting_30d
         FROM tenants t WHERE t.closed_at IS NULL AND t.purged_at IS NULL AND ${merchant('t.id')}`,
    )
    const states = await bounded(
      `SELECT ${ENTITLEMENT} AS state, count(*)::int AS n
         FROM tenants t LEFT JOIN subscriptions s ON s.tenant_id = t.id LEFT JOIN pos_native_tenants n ON n.tenant_id = t.id
        WHERE t.closed_at IS NULL AND t.purged_at IS NULL AND ${merchant('t.id')} GROUP BY 1`,
      [trialDays(), isRemote],
    )
    // Same definition as the merchant dashboard (routes/ledger.js /summary): erased members never count.
    const members = await bounded(
      `SELECT count(*)::int AS total, count(*) FILTER (WHERE m.created_at > now() - interval '30 days')::int AS new_30d,
              (SELECT count(*) FROM programs p JOIN tenants pt ON pt.id = p.tenant_id
                WHERE p.status = 'active' AND pt.closed_at IS NULL AND ${merchant('p.tenant_id')})::int AS active_programs
         FROM members m JOIN tenants t ON t.id = m.tenant_id
        WHERE m.erased_at IS NULL AND t.closed_at IS NULL AND ${merchant('m.tenant_id')}`,
    )
    // Gross issued/redeemed per unit, as in /ledger/summary; points and stamps are never summed.
    const flows = await bounded(
      `SELECT p.type,
              COALESCE(SUM(e.amount) FILTER (WHERE e.kind = 'earn'), 0)::bigint AS issued,
              COALESCE(-SUM(e.amount) FILTER (WHERE e.kind = 'redeem'), 0)::bigint AS redeemed
         FROM ledger_entries e
         JOIN tenants t ON t.id = e.tenant_id
         JOIN accounts a ON a.id = e.account_id AND a.tenant_id = e.tenant_id
         JOIN programs p ON p.id = a.program_id AND p.tenant_id = a.tenant_id
        WHERE e.created_at > now() - interval '30 days' AND t.closed_at IS NULL AND ${merchant('e.tenant_id')}
        GROUP BY p.type`,
    )
    // Same definition as the merchant gift-card list: voided cards carry no liability.
    const gifts = await bounded(
      `SELECT g.currency, count(*) FILTER (WHERE g.status <> 'voided')::int AS cards,
              COALESCE(SUM(g.balance_minor) FILTER (WHERE g.status <> 'voided'), 0)::bigint AS outstanding
         FROM gift_cards g JOIN tenants t ON t.id = g.tenant_id
        WHERE t.closed_at IS NULL AND ${merchant('g.tenant_id')}
        GROUP BY g.currency ORDER BY g.currency`,
    )
    // Legacy direct-Moyasar payments only. Purged workspaces keep theirs under a tombstone: counted.
    const paid = await bounded(
      `SELECT c.currency, count(*)::int AS payments, COALESCE(SUM(c.amount), 0)::bigint AS amount
         FROM subscription_checkouts c WHERE c.status = 'paid' AND ${merchant('c.tenant_id')}
        GROUP BY c.currency ORDER BY c.currency`,
    )
    const pos = await bounded(
      `SELECT (SELECT count(*) FROM pos_account_links l JOIN tenants t ON t.id = l.tenant_id
                WHERE l.key LIKE 'link:%' AND l.data->>'active' = 'true' AND t.closed_at IS NULL AND ${merchant('l.tenant_id')})::int AS active_links,
              (SELECT count(*) FROM pos_native_tenants n JOIN tenants t ON t.id = n.tenant_id
                WHERE n.managed_until > now() AND t.closed_at IS NULL AND ${merchant('n.tenant_id')})::int AS managed_workspaces,
              (SELECT count(*) FROM pos_loyalty_sales s
                WHERE s.state = 'OPEN' AND s.updated_at < now() - interval '24 hours' AND ${merchant('s.tenant_id')})::int AS stale_open_sales`,
    )
    const entitlement = states && Object.fromEntries(STATES.map((k) => [k, states.find((r) => r.state === k)?.n ?? 0]))
    const m = merchants?.[0]
    const byType = (type) => {
      const f = flows?.find((r) => r.type === type)
      return { issued: int(f?.issued ?? 0), redeemed: int(f?.redeemed ?? 0) }
    }
    const sar = paid?.find((r) => r.currency === 'SAR')
    return {
      asOf,
      merchants: m
        ? {
            open: m.open,
            new30d: m.new_30d,
            transacting30d: m.transacting_30d,
            entitled: entitlement ? STATES.filter((k) => ENTITLED.has(k)).reduce((n, k) => n + entitlement[k], 0) : null,
          }
        : null,
      entitlement,
      members: members ? { total: members[0].total, new30d: members[0].new_30d, activePrograms: members[0].active_programs } : null,
      ledger30d: flows ? { points: byType('points'), stamps: byType('stamps') } : null,
      giftCards: gifts && gifts.map((g) => ({ currency: g.currency, cards: g.cards, outstandingMinor: int(g.outstanding) })),
      collections: {
        source: 'moyasar_direct',
        totals: paid && paid.map((p) => ({ currency: p.currency, payments: p.payments, amountMinor: int(p.amount) })),
        // In remote mode payments and invoices live in mirqam-billing; nothing is stored here.
        remoteBilling: isRemote,
        remoteRevenueAvailable: false,
      },
      pos: pos ? { activeLinks: pos[0].active_links, managedWorkspaces: pos[0].managed_workspaces, staleOpenSales: pos[0].stale_open_sales } : null,
      // Kept for older clients: legacy direct-Moyasar payments, amount in halalas as a string.
      paid: paid ? { count: sar?.payments ?? 0, amount: String(int(sar?.amount ?? 0)) } : null,
      wallet: wallet.status(),
    }
  }

  let cache = null
  app.get('/api/hq-admin', requireHq, async (req, res) => {
    if (!cache || cache.at < Date.now() - CACHE_MS || req.query.refresh !== undefined) cache = { at: Date.now(), data: await overview() }
    res.json(cache.data)
  })

  app.get('/api/hq-admin/tenants', requireHq, async (req, res) => {
    const q = parse(listQuery, req.query)
    const term = likeTerm(q.q)
    const where = `t.purged_at IS NULL AND ${merchant('t.id')}`
    const [{ rows }, { rows: count }] = await Promise.all([
      db.query(
        `SELECT t.id, t.name, t.slug, t.created_at, t.closed_at, s.cycle, s.expires_at, n.managed_until, ${ENTITLEMENT} AS entitlement,
                (SELECT count(*) FROM programs p WHERE p.tenant_id = t.id AND p.status = 'active')::int AS active_programs,
                (SELECT count(*) FROM members m WHERE m.tenant_id = t.id AND m.erased_at IS NULL)::int AS members,
                (SELECT max(e.created_at) FROM ledger_entries e WHERE e.tenant_id = t.id) AS last_activity_at
           FROM tenants t LEFT JOIN subscriptions s ON s.tenant_id = t.id LEFT JOIN pos_native_tenants n ON n.tenant_id = t.id
          WHERE ${where} AND ($3::text IS NULL OR t.name ILIKE $3 OR t.slug ILIKE $3)
          ORDER BY t.closed_at IS NOT NULL, t.created_at DESC, t.id LIMIT $4 OFFSET $5`,
        [trialDays(), remote(), term, q.limit, q.offset],
      ),
      db.query(`SELECT count(*)::int AS total FROM tenants t WHERE ${where} AND ($1::text IS NULL OR t.name ILIKE $1 OR t.slug ILIKE $1)`, [term]),
    ])
    res.json({
      items: rows.map((r) => ({
        id: r.id,
        name: r.name,
        slug: r.slug,
        status: r.closed_at ? 'closed' : 'open',
        createdAt: r.created_at,
        closedAt: r.closed_at,
        entitlement: r.closed_at ? null : r.entitlement,
        cycle: r.cycle ?? null,
        expiresAt: r.expires_at ?? null,
        managedUntil: r.managed_until ?? null,
        activePrograms: r.active_programs,
        members: r.members,
        lastActivityAt: r.last_activity_at ?? null,
      })),
      total: count[0].total,
      limit: q.limit,
      offset: q.offset,
    })
  })

  /* One merchant, every figure bounded by its tenant id. Counts only: no member personal data
     and no owner contact details. */
  app.get('/api/hq-admin/tenants/:id', requireHq, async (req, res) => {
    const tenantId = parse(id, req.params.id)
    const {
      rows: [t],
    } = await db.query(`SELECT id, name, slug, created_at, closed_at, purge_after FROM tenants t WHERE t.id = $1 AND t.purged_at IS NULL AND ${merchant('t.id')}`, [
      tenantId,
    ])
    if (!t) throw new HttpError(404, 'tenant_not_found')
    const rows = (sql) => db.query(sql, [tenantId]).then((r) => r.rows)
    const [team, programs, joinable, members, gifts, subs, pos, checkouts, events] = await Promise.all([
      rows('SELECT role, count(*)::int AS n FROM memberships WHERE tenant_id = $1 GROUP BY role'),
      rows('SELECT type, status, count(*)::int AS n FROM programs WHERE tenant_id = $1 GROUP BY type, status'),
      rows("SELECT id, name, type FROM programs WHERE tenant_id = $1 AND status = 'active' AND self_enroll ORDER BY created_at"),
      rows(
        `SELECT count(*) FILTER (WHERE erased_at IS NULL)::int AS total,
                count(*) FILTER (WHERE erased_at IS NULL AND created_at > now() - interval '30 days')::int AS new_30d,
                (SELECT max(created_at) FROM ledger_entries WHERE tenant_id = $1) AS last_activity_at
           FROM members WHERE tenant_id = $1`,
      ),
      rows(
        `SELECT currency, count(*)::int AS cards, count(*) FILTER (WHERE status = 'voided')::int AS voided,
                COALESCE(SUM(initial_minor), 0)::bigint AS issued, COALESCE(SUM(balance_minor) FILTER (WHERE status <> 'voided'), 0)::bigint AS outstanding
           FROM gift_cards WHERE tenant_id = $1 GROUP BY currency ORDER BY currency`,
      ),
      rows('SELECT cycle, status, plan, auto_renew, cancel_at_period_end, period_end, expires_at FROM subscriptions WHERE tenant_id = $1'),
      rows(
        `SELECT (SELECT count(*) FROM pos_account_links WHERE tenant_id = $1 AND key LIKE 'link:%' AND data->>'active' = 'true')::int AS active_links,
                EXISTS (SELECT 1 FROM pos_native_tenants WHERE tenant_id = $1) AS native,
                (SELECT managed_until FROM pos_native_tenants WHERE tenant_id = $1) AS managed_until,
                EXISTS (SELECT 1 FROM pos_loyalty_settings WHERE tenant_id = $1) AS configured,
                (SELECT count(*) FROM pos_loyalty_sales WHERE tenant_id = $1 AND state = 'OPEN' AND updated_at < now() - interval '24 hours')::int AS stale_open_sales`,
      ),
      rows('SELECT id, cycle, amount, currency, status, created_at, paid_at FROM subscription_checkouts WHERE tenant_id = $1 ORDER BY created_at DESC, id LIMIT 20'),
      rows('SELECT id, kind, created_at FROM subscription_events WHERE tenant_id = $1 ORDER BY created_at DESC, id LIMIT 20'),
    ])
    let entitlement = null
    if (!t.closed_at && typeof billing()?.entitlement === 'function') {
      try {
        entitlement = await billing().entitlement(tenantId)
      } catch (err) {
        console.warn('[hq] entitlement unavailable:', err.message)
      }
    }
    const count = (list, where) => list.filter(where).reduce((n, r) => n + r.n, 0)
    const sub = subs[0]
    const p = pos[0]
    res.json({
      asOf: new Date().toISOString(),
      tenant: { id: t.id, name: t.name, slug: t.slug, status: t.closed_at ? 'closed' : 'open', createdAt: t.created_at, closedAt: t.closed_at, purgeAfter: t.purge_after },
      entitlement: mapEntitlement(entitlement),
      subscription: sub
        ? {
            cycle: sub.cycle,
            expiresAt: sub.expires_at,
            // Status, plan and renewal fields are only maintained by unified billing.
            ...(remote() ? { status: sub.status, plan: sub.plan, autoRenew: sub.auto_renew, cancelAtPeriodEnd: sub.cancel_at_period_end, periodEnd: sub.period_end } : {}),
          }
        : null,
      team: {
        owners: count(team, (r) => r.role === 'owner'),
        staff: Object.fromEntries(['manager', 'cashier', 'analyst'].map((role) => [role, count(team, (r) => r.role === role)])),
      },
      programs: Object.fromEntries(
        ['points', 'stamps'].map((type) => [type, Object.fromEntries(['active', 'draft', 'archived'].map((s) => [s, count(programs, (r) => r.type === type && r.status === s)]))]),
      ),
      joinPrograms: t.closed_at ? [] : joinable.map((r) => ({ id: r.id, name: r.name, type: r.type })),
      members: { total: members[0].total, new30d: members[0].new_30d },
      lastActivityAt: members[0].last_activity_at ?? null,
      giftCards: gifts.map((g) => ({ currency: g.currency, cards: g.cards, voided: g.voided, issuedMinor: int(g.issued), outstandingMinor: int(g.outstanding) })),
      pos: { activeLinks: p.active_links, native: p.native, managedUntil: p.managed_until ?? null, configured: p.configured, staleOpenSales: p.stale_open_sales },
      checkouts: checkouts.map((c) => ({
        id: c.id,
        cycle: c.cycle,
        amountMinor: int(c.amount),
        currency: c.currency,
        status: c.status,
        createdAt: c.created_at,
        paidAt: c.paid_at ?? null,
      })),
      events: events.map((e) => ({ id: e.id, kind: e.kind, createdAt: e.created_at })),
      billing: { remote: remote(), syncAvailable: remote() && typeof billing()?.sync === 'function' && !t.closed_at },
    })
  })

  /* Re-reads one merchant's entitlement from mirqam-billing (remote mode only). Audited under
     the HQ workspace, because every audit_log row belongs to a tenant. */
  app.post('/api/hq-admin/tenants/:id/billing-sync', requireHq, async (req, res) => {
    const tenantId = parse(id, req.params.id)
    if (!remote() || typeof billing()?.sync !== 'function') throw new HttpError(409, 'billing_sync_unavailable')
    const { rows } = await db.query(`SELECT 1 FROM tenants t WHERE t.id = $1 AND t.closed_at IS NULL AND ${merchant('t.id')}`, [tenantId])
    if (!rows.length) throw new HttpError(404, 'tenant_not_found')
    await billing().sync(tenantId)
    await db.query("INSERT INTO audit_log (tenant_id, actor_user_id, action, target) VALUES ($1, $2, 'hq.billing_synced', $3)", [
      req.auth.tenantId,
      req.auth.userId,
      `tenant:${tenantId}`,
    ])
    res.json({ ok: true, entitlement: mapEntitlement(await billing().entitlement(tenantId)) })
  })
}
