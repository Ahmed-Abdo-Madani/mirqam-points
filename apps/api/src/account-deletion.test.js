/* Account deletion and erasure (account-deletion.js) against a real API and
   database: what an owner's deletion purges, what it keeps, staff deletion and
   removal, member erasure, the hourly sweep and billing-record retention. */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { purgeTenant, runPurges } from './account-deletion.js'
import { createApp } from './app.js'
import { loadConfig } from './config.js'
import { reconcile } from './ledger.js'
import { freshDb } from './testing.js'
import { renderStrip } from './wallet/strip.js'

let db, server, base
let seq = 0
const uniq = () => {
  seq += 1
  return `${Date.now().toString(36)}${seq}`
}
const phone = () => `05${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`
const idem = () => ({ 'idempotency-key': `k-${uniq()}-${Math.random().toString(36).slice(2)}` })
const png = (size) => renderStrip({ width: size, height: size, total: 1, filled: 1 }).toString('base64')

beforeAll(async () => {
  db = await freshDb()
  const config = loadConfig({ NODE_ENV: 'test', AUTH_RATE_LIMIT: '1000' })
  server = createApp({ db, config }).listen(0, '127.0.0.1')
  await new Promise((resolve) => server.once('listening', resolve))
  base = `http://127.0.0.1:${server.address().port}`
})
afterAll(async () => {
  await new Promise((resolve) => server.close(resolve))
  await db.close()
})

/** A cookie-keeping API client. */
function client() {
  let cookie = ''
  const call = async (method, path, body, headers = {}) => {
    const res = await fetch(base + path, {
      method,
      headers: { ...(cookie ? { cookie } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...headers },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
    const set = res.headers.get('set-cookie')
    if (set) cookie = set.split(';')[0].endsWith('=') ? '' : set.split(';')[0]
    const text = await res.text()
    let data
    try {
      data = text ? JSON.parse(text) : null
    } catch {
      data = text
    }
    return { status: res.status, body: data }
  }
  return {
    get: (p) => call('GET', p),
    post: (p, b = {}, h) => call('POST', p, b, h),
    put: (p, b, h) => call('PUT', p, b, h),
    patch: (p, b) => call('PATCH', p, b),
    del: (p) => call('DELETE', p, {}),
  }
}

async function ok(promise, status = 200) {
  const res = await promise
  if (res.status !== status) throw new Error(`expected ${status}, got ${res.status} ${JSON.stringify(res.body)}`)
  return res.body
}

async function owner() {
  const a = client()
  a.email = `owner-${uniq()}@example.test`
  a.me = await ok(a.post('/api/auth/register', { email: a.email, password: 'correct-horse-9', name: 'Owner', businessName: `Store ${uniq()}` }), 201)
  return a
}

async function staff(boss, role = 'cashier') {
  const email = `${role}-${uniq()}@example.test`
  await ok(boss.post('/api/staff', { email, name: `${role} name`, role, password: 'staff-pass-123' }), 201)
  const a = client()
  a.email = email
  a.me = await ok(a.post('/api/auth/login', { email, password: 'staff-pass-123' }))
  return a
}

async function program(boss, type = 'points') {
  const config = type === 'points' ? { pointsPerUnit: 1, unitMinor: 100 } : { stampsPerVisit: 1, stampsRequired: 8 }
  const p = await ok(boss.post('/api/programs', { name: `P ${type}`, type, config }), 201)
  await ok(boss.patch(`/api/programs/${p.id}`, { status: 'active' }))
  return p
}

async function member(boss, extra = {}) {
  return ok(boss.post('/api/members', { phone: phone(), name: 'Noura', email: 'noura@example.test', marketingConsent: true, ...extra }), 201)
}

const count = async (sql, params) => (await db.query(sql, params)).rows[0].n

/** Every table with a tenant_id column, so a new table the purge forgets fails this suite. */
async function tenantRows(tenantId) {
  const { rows: tables } = await db.query(
    "SELECT table_name FROM information_schema.columns WHERE column_name = 'tenant_id' AND table_schema = current_schema() ORDER BY table_name",
  )
  const out = {}
  for (const { table_name } of tables) out[table_name] = await count(`SELECT count(*)::int AS n FROM ${table_name} WHERE tenant_id = $1`, [tenantId])
  return out
}

/** A workspace with data in every table: staff, programs, stamp art, logo, members, ledger, gift cards, campaigns, POS, wallet, billing. */
async function fullWorkspace() {
  const boss = await owner()
  const tenantId = boss.me.tenant.id
  const cashier = await staff(boss)
  const points = await program(boss)
  const stamps = await program(boss, 'stamps')
  await ok(boss.put(`/api/program-stamps/${stamps.id}`, { png: png(64) }))
  await ok(boss.put('/api/branding/logo', { png: png(128) }))
  await ok(boss.put('/api/billing/contact', { phone: '0501234567' }))
  const m = await member(boss)
  await ok(cashier.post('/api/ledger/earn', { programId: points.id, memberId: m.id, purchaseMinor: 5000 }, idem()), 201)
  const spent = await ok(cashier.post('/api/ledger/redeem', { programId: points.id, memberId: m.id, points: 10 }, idem()), 201)
  // A void references the entry it reverses: the purge must delete self-referencing rows too.
  await ok(boss.post('/api/ledger/void', { entryId: spent.entry.id }, idem()), 201)
  await ok(cashier.post('/api/ledger/earn', { programId: stamps.id, memberId: m.id }, idem()), 201)
  const gift = await ok(
    cashier.post('/api/gift-cards', { amountMinor: 10000, recipientName: 'Sara', recipientPhone: '0559876543', message: 'Happy birthday' }, idem()),
    201,
  )
  await ok(boss.post('/api/campaigns', { programId: points.id, title: 'Hi', body: 'Double points', audience: 'all' }, idem()), 201)
  const {
    rows: [account],
  } = await db.query('SELECT id, pass_version FROM accounts WHERE tenant_id = $1 AND program_id = $2', [tenantId, points.id])
  const { rows: entries } = await db.query("SELECT id FROM ledger_entries WHERE tenant_id = $1 AND kind = 'earn' LIMIT 1", [tenantId])
  // Rows only devices, POS, HQ and billing create.
  await db.query("INSERT INTO apple_registrations (device_id, pass_type_id, serial, push_token) VALUES ($1, 'pass.test', $2, 'push-a')", [
    `dev-${uniq()}`,
    `acct-${account.id}-v${account.pass_version}`,
  ])
  await db.query("INSERT INTO apple_registrations (device_id, pass_type_id, serial, push_token) VALUES ($1, 'pass.test', $2, 'push-g')", [
    `dev-${uniq()}`,
    `gift-${gift.card.id}`,
  ])
  await db.query("INSERT INTO social_identities (provider, subject, user_id) VALUES ('google', $1, $2)", [`sub-${uniq()}`, cashier.me.user.id])
  await db.query("INSERT INTO pos_account_links (key, tenant_id, data) VALUES ($1, $2, '{}')", [`link:${uniq()}`, tenantId])
  await db.query('INSERT INTO pos_provisioned_accounts (subject, tenant_id, user_id) VALUES ($1, $2, $3)', [`pos-${uniq()}`, tenantId, boss.me.user.id])
  await db.query('INSERT INTO pos_native_tenants (pos_tenant, tenant_id, user_id) VALUES ($1, $2, $3)', [`posn-${uniq()}`, tenantId, boss.me.user.id])
  const posTenant = `post-${uniq()}`
  await db.query('INSERT INTO pos_loyalty_settings (tenant_id, pos_tenant, program_id, points_per_sar, stamp_reward_minor) VALUES ($1, $2, $3, 1, 0)', [
    tenantId,
    posTenant,
    points.id,
  ])
  await db.query(
    "INSERT INTO pos_loyalty_sales (tenant_id, pos_tenant, order_ref, request_hash, account_id, program_id, state, earn_entry) VALUES ($1, $2, 'o-1', 'h', $3, $4, 'PAID', $5)",
    [tenantId, posTenant, account.id, points.id, entries[0].id],
  )
  await db.query("INSERT INTO pos_loyalty_imports (tenant_id, pos_tenant, source_ref, request_hash, account_id) VALUES ($1, $2, 's-1', 'h', $3)", [
    tenantId,
    posTenant,
    account.id,
  ])
  await db.query('INSERT INTO hq_admin_access (tenant_id, user_id, enabled, bridge_key) VALUES ($1, $2, false, $3)', [
    tenantId,
    boss.me.user.id,
    'c'.repeat(64),
  ])
  await db.query("INSERT INTO subscriptions (tenant_id, cycle, expires_at) VALUES ($1, 'monthly', now() + interval '20 days')", [tenantId])
  await db.query("INSERT INTO subscription_events (tenant_id, kind, ref) VALUES ($1, 'activated', 'a-1')", [tenantId])
  await db.query(
    "INSERT INTO subscription_checkouts (tenant_id, request_key, cycle, amount, status, paid_at, invoice_id) VALUES ($1, 'rk-1', 'monthly', 9900, 'paid', now(), $2)",
    [tenantId, `inv-${uniq()}`],
  )
  return { boss, cashier, tenantId, points, member: m, gift: gift.card }
}

describe('owner deletes their account', () => {
  it('purges the whole workspace at once and keeps only billing records under an anonymous tombstone', async () => {
    const w = await fullWorkspace()
    const before = await tenantRows(w.tenantId)
    for (const table of ['accounts', 'members', 'ledger_entries', 'gift_cards', 'gift_card_entries', 'campaigns', 'program_stamps', 'pos_loyalty_sales'])
      expect(before[table], table).toBeGreaterThan(0)
    const bystander = await owner()
    const bystanderProgram = await program(bystander)
    const bystanderMember = await member(bystander)
    await ok(bystander.post('/api/ledger/earn', { programId: bystanderProgram.id, memberId: bystanderMember.id, purchaseMinor: 1000 }, idem()), 201)

    expect((await w.boss.post('/api/auth/delete-account', { password: 'wrong-password' })).status).toBe(401)
    expect(await ok(w.boss.post('/api/auth/delete-account', { password: 'correct-horse-9' }))).toEqual({ ok: true, workspaceDeleted: true })

    const after = await tenantRows(w.tenantId)
    expect(Object.entries(after).filter(([table, n]) => n > 0 && table !== 'subscription_checkouts')).toEqual([])
    expect(after.subscription_checkouts).toBe(1)
    const {
      rows: [tomb],
    } = await db.query('SELECT name, slug, logo, logo_version, billing_phone, closed_at, purged_at FROM tenants WHERE id = $1', [w.tenantId])
    expect(tomb).toMatchObject({ name: 'deleted', logo: null, logo_version: 0, billing_phone: null })
    expect(tomb.slug).toMatch(/^deleted-[0-9a-f]{24}$/)
    expect(tomb.closed_at && tomb.purged_at).toBeTruthy()
    // Owner and staff logins are gone (their entries went with the workspace), with their sign-in links.
    expect(await count('SELECT count(*)::int AS n FROM users WHERE id = ANY($1::uuid[])', [[w.boss.me.user.id, w.cashier.me.user.id]])).toBe(0)
    expect(await count('SELECT count(*)::int AS n FROM social_identities WHERE user_id = $1', [w.cashier.me.user.id])).toBe(0)
    expect(await count("SELECT count(*)::int AS n FROM apple_registrations WHERE push_token IN ('push-a', 'push-g')")).toBe(0)
    // Staff are signed out, the public card, gift card and logo stop resolving, and the email is free again.
    expect((await w.cashier.get('/api/auth/me')).status).toBe(401)
    expect((await client().post('/api/auth/login', { email: w.cashier.email, password: 'staff-pass-123' })).status).toBe(401)
    expect((await client().get(`/api/public/gift/${w.gift.publicToken}`)).status).toBe(404)
    await ok(client().post('/api/auth/register', { email: w.boss.email, password: 'correct-horse-9', name: 'Back', businessName: 'Again' }), 201)
    // Nobody else is touched.
    expect(await count('SELECT count(*)::int AS n FROM ledger_entries WHERE tenant_id = $1', [bystander.me.tenant.id])).toBe(1)
    expect((await ok(bystander.get('/api/members'))).total).toBe(1)
    expect(await reconcile(db)).toEqual([])
  })

  it('leaves nothing at all for a workspace without billing records', async () => {
    const boss = await owner()
    const p = await program(boss)
    const m = await member(boss)
    await ok(boss.post('/api/ledger/earn', { programId: p.id, memberId: m.id, purchaseMinor: 1000 }, idem()), 201)
    await ok(boss.post('/api/auth/delete-account', { password: 'correct-horse-9' }))
    expect(await count('SELECT count(*)::int AS n FROM tenants WHERE id = $1', [boss.me.tenant.id])).toBe(0)
    expect(await count('SELECT count(*)::int AS n FROM users WHERE id = $1', [boss.me.user.id])).toBe(0)
  })

  it('a co-owned workspace stays; only the leaving owner is erased', async () => {
    const boss = await owner()
    const partner = await staff(boss, 'manager')
    await ok(boss.patch(`/api/staff/${partner.me.user.id}`, { role: 'owner' }))
    await ok(boss.post('/api/auth/delete-account', { password: 'correct-horse-9' }))
    expect((await db.query('SELECT closed_at FROM tenants WHERE id = $1', [boss.me.tenant.id])).rows[0].closed_at).toBeNull()
    expect((await ok(partner.get('/api/auth/me'))).role).toBe('owner')
  })
})

describe('staff', () => {
  it('a cashier deleting their account erases the login while the workspace and its history stay', async () => {
    const boss = await owner()
    const cashier = await staff(boss)
    const p = await program(boss)
    const m = await member(boss)
    await ok(cashier.post('/api/ledger/earn', { programId: p.id, memberId: m.id, purchaseMinor: 2000 }, idem()), 201)
    expect(await ok(cashier.post('/api/auth/delete-account', { password: 'staff-pass-123' }))).toEqual({ ok: true, workspaceDeleted: false })
    expect((await client().post('/api/auth/login', { email: cashier.email, password: 'staff-pass-123' })).status).toBe(401)
    // Still referenced by the entry it recorded: anonymised in place, not deleted.
    const {
      rows: [row],
    } = await db.query('SELECT email, name, password_hash, deleted_at FROM users WHERE id = $1', [cashier.me.user.id])
    expect(row).toMatchObject({ email: `deleted-${cashier.me.user.id}@deleted.invalid`, name: 'deleted', password_hash: 'deleted' })
    expect(row.deleted_at).toBeTruthy()
    const entries = await ok(boss.get('/api/ledger/entries'))
    expect(entries.total).toBe(1)
    expect(entries.items[0].actorName).toBeNull()
    expect((await db.query('SELECT closed_at FROM tenants WHERE id = $1', [boss.me.tenant.id])).rows[0].closed_at).toBeNull()
    // The same email can be given to a new staff member.
    await ok(boss.post('/api/staff', { email: cashier.email, name: 'New', role: 'cashier', password: 'staff-pass-123' }), 201)
  })

  it('removing staff erases the login: anonymised when it recorded entries, deleted otherwise', async () => {
    const boss = await owner()
    const busy = await staff(boss)
    const idle = await staff(boss, 'analyst')
    const p = await program(boss)
    const m = await member(boss)
    await ok(busy.post('/api/ledger/earn', { programId: p.id, memberId: m.id, purchaseMinor: 2000 }, idem()), 201)
    await ok(boss.del(`/api/staff/${busy.me.user.id}`))
    await ok(boss.del(`/api/staff/${idle.me.user.id}`))
    expect((await busy.get('/api/auth/me')).status).toBe(401)
    expect((await client().post('/api/auth/login', { email: busy.email, password: 'staff-pass-123' })).status).toBe(401)
    const {
      rows: [row],
    } = await db.query('SELECT email, name, deleted_at FROM users WHERE id = $1', [busy.me.user.id])
    expect(row.email).toBe(`deleted-${busy.me.user.id}@deleted.invalid`)
    expect(row.name).toBe('deleted')
    expect(await count('SELECT count(*)::int AS n FROM users WHERE id = $1', [idle.me.user.id])).toBe(0)
    expect((await ok(boss.get('/api/staff'))).items.map((s) => s.id)).toEqual([boss.me.user.id])
    expect((await boss.del(`/api/staff/${busy.me.user.id}`)).status).toBe(404)
  })
})

describe('member erasure', () => {
  it('wipes the member, retires their cards and forfeits the balance; history stays anonymous', async () => {
    const boss = await owner()
    const cashier = await staff(boss)
    const p = await program(boss)
    const m = await member(boss)
    const card = await ok(boss.post(`/api/members/${m.id}/accounts`, { programId: p.id }), 201)
    const token = card.passPath.split('/').pop()
    await ok(cashier.post('/api/ledger/earn', { programId: p.id, memberId: m.id, purchaseMinor: 4200 }, idem()), 201)
    const {
      rows: [acct],
    } = await db.query('SELECT pass_version FROM accounts WHERE id = $1', [card.id])
    await db.query("INSERT INTO apple_registrations (device_id, pass_type_id, serial, push_token) VALUES ($1, 'pass.test', $2, 'push-m')", [
      `dev-${uniq()}`,
      `acct-${card.id}-v${acct.pass_version}`,
    ])
    const stranger = await owner()

    expect((await cashier.del(`/api/members/${m.id}`)).status).toBe(403)
    expect((await stranger.del(`/api/members/${m.id}`)).status).toBe(404)
    expect(await ok(boss.del(`/api/members/${m.id}`))).toEqual({ ok: true, cards: 1, forfeited: 42 })
    expect((await boss.del(`/api/members/${m.id}`)).status).toBe(404)

    const {
      rows: [row],
    } = await db.query('SELECT phone, name, email, marketing_consent, consent_at, erased_at FROM members WHERE id = $1', [m.id])
    expect(row).toMatchObject({ phone: null, name: null, email: null, marketing_consent: false, consent_at: null })
    expect(row.erased_at).toBeTruthy()
    expect(await count("SELECT count(*)::int AS n FROM apple_registrations WHERE push_token = 'push-m'")).toBe(0)
    expect((await client().get(`/api/public/pass/${token}`)).status).toBe(404)
    expect((await boss.get(`/api/members/${m.id}`)).status).toBe(404)
    expect((await ok(boss.get('/api/members'))).total).toBe(0)
    expect((await ok(boss.get('/api/ledger/summary'))).members).toBe(0)
    expect((await boss.post('/api/ledger/earn', { programId: p.id, memberId: m.id, purchaseMinor: 1000 }, idem())).status).toBe(404)
    // The balance is forfeited by an `expire` entry, so the ledger still reconciles.
    const entries = await ok(boss.get(`/api/ledger/entries?memberId=${m.id}`))
    expect(entries.items.map((e) => [e.kind, e.amount])).toEqual([
      ['expire', -42],
      ['earn', 42],
    ])
    expect(entries.items[0].member).toEqual({ id: m.id, phone: null, name: null })
    expect((await boss.post('/api/ledger/void', { entryId: entries.items[1].id }, idem())).status).toBe(404)
    expect(await reconcile(db, { tenantId: boss.me.tenant.id })).toEqual([])
    expect((await boss.get(`/api/campaigns/audience?programId=${p.id}&audience=all`)).body.recipients).toBe(0)
    // The same person can join again later as a new member.
    expect((await boss.post('/api/members', { phone: m.phone })).status).toBe(201)
  })
})

describe('paywall', () => {
  it('a lapsed subscription blocks writes but never a member erasure or staff removal', async () => {
    const boss = await owner()
    const cashier = await staff(boss)
    const m = await member(boss)
    // POS-provisioned workspaces are always gated; this one's trial ended long ago.
    await db.query("UPDATE tenants SET created_at = now() - interval '400 days' WHERE id = $1", [boss.me.tenant.id])
    await db.query('INSERT INTO pos_provisioned_accounts (subject, tenant_id, user_id) VALUES ($1, $2, $3)', [
      `gate-${uniq()}`,
      boss.me.tenant.id,
      boss.me.user.id,
    ])
    expect((await boss.post('/api/members', { phone: phone() })).status).toBe(402)
    await ok(boss.del(`/api/members/${m.id}`))
    await ok(boss.del(`/api/staff/${cashier.me.user.id}`))
  })
})

describe('sweep and retention', () => {
  it('purges workspaces closed before this release, never an open one', async () => {
    const legacy = await owner()
    const p = await program(legacy)
    const m = await member(legacy)
    await ok(legacy.post('/api/ledger/earn', { programId: p.id, memberId: m.id, purchaseMinor: 1000 }, idem()), 201)
    const open = await owner()
    expect(await purgeTenant(db, open.me.tenant.id)).toBeNull()
    // What migration 016 does for workspaces an older release only closed.
    await db.query('UPDATE tenants SET closed_at = now(), purge_after = now() WHERE id = $1', [legacy.me.tenant.id])
    expect((await runPurges(db)).purged).toBeGreaterThanOrEqual(1)
    expect(await count('SELECT count(*)::int AS n FROM tenants WHERE id = $1', [legacy.me.tenant.id])).toBe(0)
    expect(await count('SELECT count(*)::int AS n FROM tenants WHERE id = $1 AND closed_at IS NULL', [open.me.tenant.id])).toBe(1)
  })

  it('keeps billing records for the legal period, then removes them and the tombstone', async () => {
    const boss = await owner()
    const tenantId = boss.me.tenant.id
    await db.query(
      "INSERT INTO subscription_checkouts (tenant_id, request_key, cycle, amount, status, paid_at) VALUES ($1, 'old', 'yearly', 99000, 'paid', $2), ($1, 'new', 'yearly', 99000, 'paid', $3)",
      [tenantId, new Date('2025-03-01T00:00:00Z'), new Date('2026-09-01T00:00:00Z')],
    )
    await ok(boss.post('/api/auth/delete-account', { password: 'correct-horse-9' }))
    const sweep = (iso) => runPurges(db, { now: new Date(iso) })
    await sweep('2035-12-31T00:00:00Z')
    expect(await count('SELECT count(*)::int AS n FROM subscription_checkouts WHERE tenant_id = $1', [tenantId])).toBe(2)
    await sweep('2036-01-02T00:00:00Z') // 2025 records: ten full years after the year of payment
    expect(await count('SELECT count(*)::int AS n FROM subscription_checkouts WHERE tenant_id = $1', [tenantId])).toBe(1)
    await sweep('2037-01-02T00:00:00Z')
    expect(await count('SELECT count(*)::int AS n FROM subscription_checkouts WHERE tenant_id = $1', [tenantId])).toBe(0)
    expect(await count('SELECT count(*)::int AS n FROM tenants WHERE id = $1', [tenantId])).toBe(0)
  })

  it('the ledgers stay append-only outside the purge of a closed workspace', async () => {
    const boss = await owner()
    const tenantId = boss.me.tenant.id
    const p = await program(boss)
    const m = await member(boss)
    await ok(boss.post('/api/ledger/earn', { programId: p.id, memberId: m.id, purchaseMinor: 1000 }, idem()), 201)
    await ok(boss.post('/api/gift-cards', { amountMinor: 5000 }, idem()), 201)
    const asPurge = (sql) =>
      db.tx(async (tx) => {
        await tx.query("SELECT set_config('mirqam.purge_tenant', $1, true)", [tenantId])
        await tx.query(sql, [tenantId])
      })
    // Open workspace: even inside a declared purge.
    await expect(asPurge('DELETE FROM ledger_entries WHERE tenant_id = $1')).rejects.toThrow(/append-only/)
    await expect(asPurge('DELETE FROM gift_card_entries WHERE tenant_id = $1')).rejects.toThrow(/append-only/)
    await db.query('UPDATE tenants SET closed_at = now() WHERE id = $1', [tenantId])
    // Closed workspace, but no purge declared, or an UPDATE: still blocked.
    await expect(db.query('DELETE FROM ledger_entries WHERE tenant_id = $1', [tenantId])).rejects.toThrow(/append-only/)
    await expect(asPurge("UPDATE ledger_entries SET note = 'x' WHERE tenant_id = $1")).rejects.toThrow(/append-only/)
    await expect(asPurge("UPDATE gift_card_entries SET note = 'x' WHERE tenant_id = $1")).rejects.toThrow(/append-only/)
    expect(await count('SELECT count(*)::int AS n FROM ledger_entries WHERE tenant_id = $1', [tenantId])).toBe(1)
  })
})

describe('public deletion page', () => {
  it('the server serves the console at /delete-account to anyone, like /privacy and /support', async () => {
    const dist = mkdtempSync(join(tmpdir(), 'mp-web-'))
    writeFileSync(join(dist, 'index.html'), '<!doctype html><div id="root">console</div>')
    const web = createApp({ db, config: loadConfig({ NODE_ENV: 'test', WEB_DIST: dist }) }).listen(0, '127.0.0.1')
    await new Promise((resolve) => web.once('listening', resolve))
    try {
      for (const path of ['/delete-account', '/privacy', '/support']) {
        const res = await fetch(`http://127.0.0.1:${web.address().port}${path}`)
        expect(res.status, path).toBe(200)
        expect(res.headers.get('content-type')).toMatch(/text\/html/)
        expect(await res.text()).toContain('console')
      }
    } finally {
      await new Promise((resolve) => web.close(resolve))
      rmSync(dist, { recursive: true, force: true })
    }
  })
})
