import { request as httpRequest } from 'node:http'
import express from 'express'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { createApp } from './app.js'
import { createSession, loadSession } from './auth.js'
import { loadConfig } from './config.js'
import { installHqAdmin } from './hq-admin.js'
import { errorHandler } from './http.js'
import { earn, ensureAccount, redeem } from './ledger.js'
import { freshDb, seedTenant } from './testing.js'

let db, server, base, admin, customer, adminCookie, customerCookie
let grant,
  accepted = false
const code = 'a'.repeat(64)
beforeAll(async () => {
  db = await freshDb()
  admin = await seedTenant(db)
  customer = await seedTenant(db)
  for (const [label, t] of [
    ['admin', admin],
    ['customer', customer],
  ]) {
    const {
      rows: [u],
    } = await db.query('INSERT INTO users(email,password_hash,name) VALUES($1,$2,$3) RETURNING id', [label + '@example.test', 'not-a-login-hash', label])
    t.userId = u.id
    await db.query("INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,'owner')", [t.tenantId, u.id])
  }
  await db.query('INSERT INTO hq_admin_access(tenant_id,user_id,enabled,bridge_key) VALUES($1,$2,true,$3)', [admin.tenantId, admin.userId, 'b'.repeat(64)])
  customerCookie = 'mp_session=' + (await createSession(db, { userId: customer.userId, tenantId: customer.tenantId, ttlDays: 1 }))
  grant = { userId: admin.userId, audience: 'https://loyalty.mirqam.sa', role: 'superadmin' }
  const app = express()
  app.use(express.json(), loadSession(db))
  installHqAdmin(app, {
    db,
    config: { production: true },
    wallet: { status: () => ({ apple: false, google: false }) },
    request: async (url, opts) => {
      expect(url).toBe('https://mirqam.sa/m/ad0ed94a6a279f02a1295ae283efa07d2c18/bridge/consume')
      expect(opts.headers.Authorization).toBe('Bearer ' + 'b'.repeat(64))
      expect(opts.redirect).toBe('error')
      expect(JSON.parse(opts.body)).toEqual({ platform: 'loyalty', code })
      if (accepted) return { ok: false }
      accepted = grant.role === 'superadmin'
      return { ok: true, json: async () => grant }
    },
  })
  app.use(errorHandler)
  server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s))
  })
  base = 'http://127.0.0.1:' + server.address().port
})
afterAll(async () => {
  await new Promise((r) => server.close(r))
  await db.close()
})
const entry = (origin = 'https://loyalty.mirqam.sa') =>
  new Promise((resolve, reject) => {
    const req = httpRequest(
      base + '/api/hq-entry',
      { method: 'POST', headers: { host: 'loyalty.mirqam.sa', origin, 'content-type': 'application/json' } },
      (res) => {
        let body = ''
        res.on('data', (d) => (body += d))
        res.on('end', () =>
          resolve({
            status: res.statusCode,
            headers: {
              get: (key) => {
                const v = res.headers[key]
                return Array.isArray(v) ? v[0] : v
              },
            },
            json: async () => JSON.parse(body),
          }),
        )
      },
    )
    req.on('error', reject)
    req.end(JSON.stringify({ code }))
  })
test('anonymous and ordinary tenant owners cannot read global administration', async () => {
  expect((await fetch(base + '/api/hq-admin')).status).toBe(401)
  expect((await fetch(base + '/api/hq-admin', { headers: { cookie: customerCookie } })).status).toBe(403)
})
test('foreign origins and mismatched grant roles fail without creating a session', async () => {
  expect((await entry('https://example.test')).status).toBe(403)
  grant.role = 'owner'
  expect((await entry()).status).toBe(403)
  grant.role = 'superadmin'
  const {
    rows: [r],
  } = await db.query('SELECT count(*)::int AS count FROM sessions WHERE user_id=$1', [admin.userId])
  expect(r.count).toBe(0)
})
test('valid single-use handoff creates a secure native session and redacted overview', async () => {
  const r = await entry()
  expect(r.status).toBe(200)
  const c = r.headers.get('set-cookie')
  expect(c).toContain('HttpOnly')
  expect(c).toContain('Secure')
  expect(c).toContain('SameSite=Lax')
  adminCookie = c.split(';')[0]
  const result = await fetch(base + '/api/hq-admin', { headers: { cookie: adminCookie } })
  expect(result.status).toBe(200)
  expect(result.headers.get('cache-control')).toBe('no-store')
  const body = await result.json()
  expect(body.merchants.open).toBe(1)
  expect(body.members.total).toBe(1)
  expect(body.paid.amount).toBe('0')
  const list = await (await fetch(base + '/api/hq-admin/tenants', { headers: { cookie: adminCookie } })).json()
  expect(list.items.map((t) => t.id)).toEqual([customer.tenantId])
  expect(list.items[0].members).toBe(1)
  expect(JSON.stringify([body, list])).not.toMatch(/bridge_key|password_hash|token_hash/)
  expect((await entry()).status).toBe(401)
})
test('disabling the dedicated grant revokes HQ access without altering tenant owners', async () => {
  await db.query('UPDATE hq_admin_access SET enabled=false WHERE user_id=$1', [admin.userId])
  expect((await fetch(base + '/api/hq-admin', { headers: { cookie: adminCookie } })).status).toBe(403)
  const {
    rows: [m],
  } = await db.query('SELECT role FROM memberships WHERE user_id=$1 AND tenant_id=$2', [customer.userId, customer.tenantId])
  expect(m.role).toBe('owner')
  expect((await entry()).status).toBe(403)
})

/* The full API (createApp): guard on every HQ route, KPI definitions on seeded data, the merchant
   list and the merchant profile. Grants are inserted directly; nothing here can create one. */
describe('HQ administration through the full API', () => {
  let db, app, server, base, hq, plain, manager, ids
  let seq = 0
  const uniq = () => `${Date.now().toString(36)}${++seq}`
  const call = async (path, { cookie, method = 'GET', body } = {}) => {
    const res = await fetch(base + path, {
      method,
      headers: { ...(cookie ? { cookie } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    })
    const text = await res.text()
    return { status: res.status, headers: res.headers, body: text ? JSON.parse(text) : null }
  }
  const tenant = async (name, slug) => (await db.query('INSERT INTO tenants (name, slug) VALUES ($1, $2) RETURNING id', [name, slug])).rows[0].id
  const login = async (tenantId, role = 'owner') => {
    const {
      rows: [u],
    } = await db.query('INSERT INTO users (email, password_hash, name) VALUES ($1, $2, $3) RETURNING id', [
      `u-${uniq()}@example.test`,
      'not-a-login-hash',
      'User',
    ])
    await db.query('INSERT INTO memberships (tenant_id, user_id, role) VALUES ($1, $2, $3)', [tenantId, u.id, role])
    return { userId: u.id, tenantId, cookie: `mp_session=${await createSession(db, { userId: u.id, tenantId, ttlDays: 1 })}` }
  }
  const program = async (tenantId, type, status = 'active', selfEnroll = false) =>
    (
      await db.query('INSERT INTO programs (tenant_id, name, type, status, self_enroll) VALUES ($1, $2, $3, $4, $5) RETURNING id', [
        tenantId,
        `${type} ${status}`,
        type,
        status,
        selfEnroll,
      ])
    ).rows[0].id
  const member = async (tenantId, phone, erased = false) =>
    (await db.query(`INSERT INTO members (tenant_id, phone, erased_at) VALUES ($1, $2, ${erased ? 'now()' : 'NULL'}) RETURNING id`, [tenantId, phone])).rows[0]
      .id
  const giftCard = (tenantId, initial, balance, status = 'active') =>
    db.query(
      'INSERT INTO gift_cards (tenant_id, code_hash, code_last4, code_sealed, public_token, initial_minor, balance_minor, status) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
      [tenantId, `h-${uniq()}`, '1234', 'sealed', `p-${uniq()}`, initial, balance, status],
    )
  const checkout = (tenantId, amount, status) =>
    db.query(
      `INSERT INTO subscription_checkouts (tenant_id, request_key, cycle, amount, status, paid_at, invoice_id) VALUES ($1, $2, 'monthly', $3, $4, ${status === 'paid' ? 'now()' : 'NULL'}, $5)`,
      [tenantId, `rk-${uniq()}`, amount, status, `inv-${uniq()}`],
    )

  beforeAll(async () => {
    db = await freshDb()
    app = createApp({ db, config: loadConfig({ NODE_ENV: 'test', AUTH_RATE_LIMIT: '1000' }) })
    server = app.listen(0, '127.0.0.1')
    await new Promise((resolve) => server.once('listening', resolve))
    base = `http://127.0.0.1:${server.address().port}`

    const hqTenant = await tenant('Mirqam HQ', `hq-${uniq()}`)
    hq = await login(hqTenant)
    manager = await login(hqTenant, 'manager')
    for (const u of [hq, manager]) {
      await db.query('INSERT INTO hq_admin_access (tenant_id, user_id, enabled, bridge_key) VALUES ($1, $2, true, $3)', [hqTenant, u.userId, 'd'.repeat(64)])
    }
    await checkout(hqTenant, 6900, 'paid') // HQ workspace: never a merchant figure

    // Alpha: open merchant with activity in both units, an erased member and a lapsed POS sale.
    const alpha = await tenant('Alpha Coffee', `alpha-${uniq()}`)
    const pts = await program(alpha, 'points', 'active', true)
    const stamps = await program(alpha, 'stamps')
    await program(alpha, 'points', 'archived')
    const m1 = await member(alpha, '+966500000001')
    await member(alpha, '+966500000002')
    await member(alpha, '+966500000003', true)
    const a = await ensureAccount(db, { tenantId: alpha, programId: pts, memberId: m1 })
    const s = await ensureAccount(db, { tenantId: alpha, programId: stamps, memberId: m1 })
    await earn(db, { tenantId: alpha, accountId: a.id, points: 100, idempotencyKey: `k-${uniq()}` })
    await earn(db, { tenantId: alpha, accountId: a.id, points: 50, idempotencyKey: `k-${uniq()}` })
    await redeem(db, { tenantId: alpha, accountId: a.id, points: 30, idempotencyKey: `k-${uniq()}` })
    await earn(db, { tenantId: alpha, accountId: s.id, points: 3, idempotencyKey: `k-${uniq()}` })
    await redeem(db, { tenantId: alpha, accountId: s.id, points: 1, idempotencyKey: `k-${uniq()}` })
    await db.query("INSERT INTO subscriptions (tenant_id, cycle, expires_at) VALUES ($1, 'monthly', now() + interval '20 days')", [alpha])
    await giftCard(alpha, 10000, 5000)
    await giftCard(alpha, 3000, 2000, 'voided')
    await checkout(alpha, 6900, 'paid')
    await checkout(alpha, 6900, 'pending')
    await db.query("INSERT INTO subscription_events (tenant_id, kind, ref) VALUES ($1, 'activated', 'a-1')", [alpha])
    await db.query('INSERT INTO pos_account_links (key, tenant_id, data) VALUES ($1, $2, \'{"active":true}\'), ($3, $2, \'{"active":false}\')', [
      `link:${uniq()}`,
      alpha,
      `link:${uniq()}`,
    ])
    await db.query(
      "INSERT INTO pos_loyalty_sales (tenant_id, pos_tenant, order_ref, request_hash, state, updated_at) VALUES ($1, 'pos-a', 'o-1', 'h', 'OPEN', now() - interval '2 days'), ($1, 'pos-a', 'o-2', 'h', 'OPEN', now())",
      [alpha],
    )

    // Owner: an ordinary merchant (no grant), managed by Mirqam POS.
    const ownerShop = await tenant('Owner Shop', `owner-${uniq()}`)
    plain = await login(ownerShop)
    await db.query("INSERT INTO pos_native_tenants (pos_tenant, tenant_id, managed_until) VALUES ($1, $2, now() + interval '200 days')", [
      `pos-${uniq()}`,
      ownerShop,
    ])

    // Closed workspace (owner deleted the account, purge pending) and a purged tombstone.
    const closed = await tenant('Closed Bakery', `closed-${uniq()}`)
    await program(closed, 'points')
    const cm = await member(closed, '+966500000009')
    const ca = await ensureAccount(db, {
      tenantId: closed,
      programId: (await db.query('SELECT id FROM programs WHERE tenant_id=$1', [closed])).rows[0].id,
      memberId: cm,
    })
    await earn(db, { tenantId: closed, accountId: ca.id, points: 999, idempotencyKey: `k-${uniq()}` })
    await giftCard(closed, 9000, 9000)
    await db.query('UPDATE tenants SET closed_at = now() WHERE id = $1', [closed])
    const tomb = await tenant('deleted', `deleted-${uniq()}`)
    await checkout(tomb, 69000, 'paid')
    await db.query('UPDATE tenants SET closed_at = now(), purged_at = now() WHERE id = $1', [tomb])
    ids = { hqTenant, alpha, ownerShop, closed, tomb }
  })
  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve))
    await db.close()
  })

  test('every HQ route needs an enabled grant held by the owner role', async () => {
    const routes = ['/api/hq-admin', '/api/hq-admin/tenants', `/api/hq-admin/tenants/${ids.alpha}`]
    for (const path of routes) {
      expect((await call(path)).status).toBe(401)
      const denied = await call(path, { cookie: plain.cookie })
      expect(denied.status).toBe(403)
      expect(denied.headers.get('x-robots-tag')).toBe('noindex, nofollow')
      expect((await call(path, { cookie: manager.cookie })).status).toBe(403)
      const ok = await call(path, { cookie: hq.cookie })
      expect(ok.status).toBe(200)
      expect(ok.headers.get('cache-control')).toBe('no-store')
    }
    expect((await call(`/api/hq-admin/tenants/${ids.alpha}/billing-sync`, { method: 'POST', body: {}, cookie: plain.cookie })).status).toBe(403)
  })

  test('KPIs follow the merchant definitions: open workspaces only, units never summed', async () => {
    const { body } = await call('/api/hq-admin?refresh=1', { cookie: hq.cookie })
    // Alpha and Owner Shop; the closed workspace, the tombstone and HQ are not merchants here.
    expect(body.merchants).toEqual({ open: 2, new30d: 2, transacting30d: 1, entitled: 2 })
    expect(body.entitlement).toEqual({ posManaged: 1, active: 1, expiring: 0, trial: 0, expired: 0, none: 0 })
    // The erased member and the closed workspace's member are excluded; archived programs too.
    expect(body.members).toEqual({ total: 2, new30d: 2, activePrograms: 2 })
    expect(body.ledger30d).toEqual({ points: { issued: 150, redeemed: 30 }, stamps: { issued: 3, redeemed: 1 } })
    expect(body.giftCards).toEqual([{ currency: 'SAR', cards: 1, outstandingMinor: 5000 }])
    // Legacy collections keep the tombstone's retained payment, never HQ's or a pending one.
    expect(body.collections).toEqual({
      source: 'moyasar_direct',
      totals: [{ currency: 'SAR', payments: 2, amountMinor: 75900 }],
      remoteBilling: false,
      remoteRevenueAvailable: false,
    })
    expect(body.paid).toEqual({ count: 2, amount: '75900' })
    expect(body.pos).toEqual({ activeLinks: 1, managedWorkspaces: 1, staleOpenSales: 1 })
    expect(JSON.stringify(body)).not.toMatch(/\+9665/)
  })

  test('the merchant list is paginated, searchable and camelCase', async () => {
    const all = await call('/api/hq-admin/tenants', { cookie: hq.cookie })
    expect(all.body.total).toBe(3)
    // Open workspaces first, newest first; the closed one last; HQ and the tombstone never.
    expect(all.body.items.map((t) => t.id)).toEqual([ids.ownerShop, ids.alpha, ids.closed])
    const alpha = all.body.items[1]
    expect(alpha).toMatchObject({ name: 'Alpha Coffee', status: 'open', entitlement: 'active', activePrograms: 2, members: 2, cycle: 'monthly' })
    expect(alpha.lastActivityAt).toBeTruthy()
    expect(all.body.items[0]).toMatchObject({ entitlement: 'posManaged', managedUntil: expect.any(String) })
    expect(all.body.items[2]).toMatchObject({ status: 'closed', entitlement: null })

    const page = await call('/api/hq-admin/tenants?limit=1&offset=1', { cookie: hq.cookie })
    expect(page.body).toMatchObject({ total: 3, limit: 1, offset: 1 })
    expect(page.body.items.map((t) => t.id)).toEqual([ids.alpha])
    expect((await call('/api/hq-admin/tenants?limit=101', { cookie: hq.cookie })).status).toBe(400)

    const byName = await call(`/api/hq-admin/tenants?q=${encodeURIComponent('alpha cof')}`, { cookie: hq.cookie })
    expect(byName.body.items.map((t) => t.id)).toEqual([ids.alpha])
    const bySlug = await call('/api/hq-admin/tenants?q=owner-', { cookie: hq.cookie })
    expect(bySlug.body.items.map((t) => t.id)).toEqual([ids.ownerShop])
    // LIKE wildcards are literal characters in a search.
    expect((await call('/api/hq-admin/tenants?q=%25', { cookie: hq.cookie })).body.total).toBe(0)
  })

  test('the merchant profile shows real per-tenant figures and never member data', async () => {
    const { status, body } = await call(`/api/hq-admin/tenants/${ids.alpha}`, { cookie: hq.cookie })
    expect(status).toBe(200)
    expect(body.tenant).toMatchObject({ id: ids.alpha, name: 'Alpha Coffee', status: 'open' })
    expect(body.entitlement).toMatchObject({ available: true, state: 'active', allowed: true, cycle: 'monthly' })
    expect(body.members).toEqual({ total: 2, new30d: 2 })
    expect(body.programs).toEqual({ points: { active: 1, draft: 0, archived: 1 }, stamps: { active: 1, draft: 0, archived: 0 } })
    expect(body.joinPrograms).toEqual([expect.objectContaining({ type: 'points' })])
    expect(body.giftCards).toEqual([{ currency: 'SAR', cards: 2, voided: 1, issuedMinor: 13000, outstandingMinor: 5000 }])
    expect(body.pos).toMatchObject({ activeLinks: 1, native: false, configured: false, staleOpenSales: 1 })
    expect(body.checkouts.map((c) => [c.status, c.amountMinor])).toEqual(
      expect.arrayContaining([
        ['paid', 6900],
        ['pending', 6900],
      ]),
    )
    expect(body.events.map((e) => e.kind)).toEqual(['activated'])
    expect(body.billing).toEqual({ remote: false, syncAvailable: false })
    expect(JSON.stringify(body)).not.toMatch(/\+9665|phone|email/)

    const pos = await call(`/api/hq-admin/tenants/${ids.ownerShop}`, { cookie: hq.cookie })
    expect(pos.body.entitlement).toMatchObject({ state: 'active', managedBy: 'mirqam-pos' })
    expect(pos.body.team).toEqual({ owners: 1, staff: { manager: 0, cashier: 0, analyst: 0 } })
  })

  test('unknown, HQ and purged workspaces have no profile; billing sync needs remote billing', async () => {
    for (const tenantId of ['00000000-0000-4000-8000-000000000000', ids.hqTenant, ids.tomb]) {
      const r = await call(`/api/hq-admin/tenants/${tenantId}`, { cookie: hq.cookie })
      expect(r.status).toBe(404)
      expect(r.body.error).toBe('tenant_not_found')
    }
    expect((await call('/api/hq-admin/tenants/not-a-uuid', { cookie: hq.cookie })).status).toBe(400)
    const sync = await call(`/api/hq-admin/tenants/${ids.alpha}/billing-sync`, { method: 'POST', body: {}, cookie: hq.cookie })
    expect(sync.status).toBe(409)
    expect(sync.body.error).toBe('billing_sync_unavailable')
  })

  test('with unified billing, sync re-reads one merchant and is audited under HQ', async () => {
    const local = app.locals.billing
    const synced = []
    app.locals.billing = {
      remote: true,
      sync: async (tenantId) => synced.push(tenantId),
      entitlement: async () => ({ state: 'active', allowed: true, daysLeft: 30, cycle: 'monthly', billingStatus: 'active' }),
    }
    try {
      const r = await call(`/api/hq-admin/tenants/${ids.alpha}/billing-sync`, { method: 'POST', body: {}, cookie: hq.cookie })
      expect(r.status).toBe(200)
      expect(r.body.entitlement).toMatchObject({ available: true, state: 'active', billingStatus: 'active' })
      expect(synced).toEqual([ids.alpha])
      const { rows } = await db.query("SELECT tenant_id, actor_user_id, target FROM audit_log WHERE action = 'hq.billing_synced'")
      expect(rows).toEqual([{ tenant_id: ids.hqTenant, actor_user_id: hq.userId, target: `tenant:${ids.alpha}` }])
      expect((await call(`/api/hq-admin/tenants/${ids.closed}/billing-sync`, { method: 'POST', body: {}, cookie: hq.cookie })).status).toBe(404)
      expect((await call(`/api/hq-admin/tenants/${ids.alpha}`, { cookie: hq.cookie })).body.billing).toEqual({ remote: true, syncAvailable: true })
      const kpis = await call('/api/hq-admin?refresh=1', { cookie: hq.cookie })
      expect(kpis.body.collections).toMatchObject({ remoteBilling: true, remoteRevenueAvailable: false })
    } finally {
      app.locals.billing = local
    }
  })
})
