/* HTTP battery against a running API (BASE, default http://localhost:4100).
   Usually invoked through scripts/verify.mjs, which boots a throwaway server. */
import { Agent, check, expect, expectStatus, key, phone, summary } from './harness.mjs'

async function setupProgram(owner, type = 'points', config = { pointsPerUnit: 1, unitMinor: 100 }) {
  const created = await owner.post('/api/programs', { name: `Program ${type}`, type, config })
  expectStatus(created, 201)
  expectStatus(await owner.patch(`/api/programs/${created.body.id}`, { status: 'active' }), 200)
  return created.body
}

async function setupMember(agent, p = phone()) {
  const res = await agent.post('/api/members', { phone: p, name: 'عميل تجريبي', marketingConsent: true })
  expectStatus(res, 201)
  return res.body
}

// ---------------------------------------------------------------- platform
await check('health reports ok with a database', async () => {
  const res = await new Agent().get('/api/health')
  expectStatus(res, 200)
  expect(res.body.ok).toBe(true)
})

await check('unknown API routes return JSON 404', async () => {
  const res = await new Agent().get('/api/nope')
  expectStatus(res, 404, 'not_found')
})

await check('security headers are present', async () => {
  const res = await new Agent().get('/api/health')
  expect(res.headers.get('x-content-type-options')).toBe('nosniff')
  expect(res.headers.get('content-security-policy') || '').toMatch(/frame-ancestors 'none'/)
  expect(res.headers.get('x-powered-by')).toBe(null)
})

// ---------------------------------------------------------------- auth
await check('register creates an owner session; me returns workspace', async () => {
  const a = await Agent.owner()
  expect(a.cookie).toMatch(/^mp_session=/)
  const me = await a.get('/api/auth/me')
  expectStatus(me, 200)
  expect(me.body.role).toBe('owner')
  expect(me.body.tenant.id).toBe(a.me.tenant.id)
})

await check('session cookie is HttpOnly and SameSite=Lax', async () => {
  const res = await new Agent().post('/api/auth/register', {
    email: `c-${key()}@example.test`,
    password: 'correct-horse-9',
    name: 'C',
    businessName: 'Cookie Co',
  })
  const c = res.headers.get('set-cookie')
  expect(c).toMatch(/HttpOnly/)
  expect(c).toMatch(/SameSite=Lax/)
})

await check('duplicate email is rejected (case-insensitive)', async () => {
  const a = await Agent.owner()
  const res = await new Agent().post('/api/auth/register', {
    email: a.me.user.email.toUpperCase(),
    password: 'correct-horse-9',
    name: 'X',
    businessName: 'X',
  })
  expectStatus(res, 409, 'email_taken')
})

await check('login works, wrong password and unknown email look identical', async () => {
  const a = await Agent.owner()
  const ok = await new Agent().post('/api/auth/login', { email: a.me.user.email, password: 'correct-horse-9' })
  expectStatus(ok, 200)
  const bad = await new Agent().post('/api/auth/login', { email: a.me.user.email, password: 'wrong-password' })
  expectStatus(bad, 401, 'invalid_credentials')
  const none = await new Agent().post('/api/auth/login', { email: 'nobody@example.test', password: 'wrong-password' })
  expectStatus(none, 401, 'invalid_credentials')
})

await check('logout ends the session server-side', async () => {
  const a = await Agent.owner()
  const stolen = a.cookie
  expectStatus(await a.post('/api/auth/logout'), 200)
  const replay = new Agent()
  replay.cookie = stolen
  expectStatus(await replay.get('/api/auth/me'), 401, 'unauthenticated')
})

await check('weak passwords and bad input are rejected with field details', async () => {
  const res = await new Agent().post('/api/auth/register', { email: 'not-an-email', password: 'short', name: '', businessName: 'x' })
  expectStatus(res, 400, 'validation_failed')
  expect(Array.isArray(res.body.details) && res.body.details.length >= 3).toBe(true)
})

await check('protected routes require a session', async () => {
  expectStatus(await new Agent().get('/api/programs'), 401, 'unauthenticated')
  expectStatus(await new Agent().get('/api/members'), 401, 'unauthenticated')
})

await check('billing prices include VAT, owner only, tenant isolation and no client-side activation', async () => {
  const owner = await Agent.owner()
  const cashier = await Agent.staff(owner, 'cashier')
  expectStatus(await new Agent().get('/api/billing'), 401)
  expectStatus(await cashier.get('/api/billing'), 403)
  expectStatus(await cashier.post('/api/billing/checkout', { cycle: 'monthly' }, { headers: { 'idempotency-key': key() } }), 403)
  const state = await owner.get('/api/billing')
  expectStatus(state, 200)
  expect(state.body.prices).toEqual({ monthly: 6900, yearly: 69000 })
  expect(state.body.vatIncluded).toBe(true)
  expect(state.body.subscription).toBe(null)
  expectStatus(await owner.post('/api/billing/checkout/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/confirm', { status: 'paid' }), 404)
  expectStatus(await owner.post('/api/billing/checkout/------------------------------------/confirm'), 400)
  expectStatus(await new Agent().post('/api/billing/moyasar/webhook', { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', status: 'paid' }), 200)
  expect((await owner.get('/api/billing')).body.subscription).toBe(null)
})

// ---------------------------------------------------------------- CSRF
await check('state-changing requests must be JSON', async () => {
  const a = await Agent.owner()
  const res = await a.request('POST', '/api/programs', {
    body: {},
    raw: 'name=x&type=points',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  })
  expectStatus(res, 415, 'json_required')
})

await check('foreign Origin is refused on writes', async () => {
  const a = await Agent.owner()
  const res = await a.post('/api/programs', { name: 'x', type: 'points' }, { headers: { origin: 'https://evil.example' } })
  expectStatus(res, 403, 'origin_not_allowed')
})

// ---------------------------------------------------------------- programs
await check('program lifecycle: create draft → activate → archive → reactivate, never back to draft', async () => {
  const a = await Agent.owner()
  const p = await a.post('/api/programs', { name: 'نقاط مرقام', type: 'points', config: { pointsPerUnit: 2, unitMinor: 1000 } })
  expectStatus(p, 201)
  expect(p.body.status).toBe('draft')
  expect(p.body.config.pointsPerUnit).toBe(2)
  expectStatus(await a.patch(`/api/programs/${p.body.id}`, { status: 'active' }), 200)
  expectStatus(await a.patch(`/api/programs/${p.body.id}`, { status: 'archived' }), 200)
  expectStatus(await a.patch(`/api/programs/${p.body.id}`, { status: 'active' }), 200)
  const back = await a.patch(`/api/programs/${p.body.id}`, { status: 'draft' })
  expectStatus(back, 400, 'validation_failed')
  const list = await a.get('/api/programs')
  expect(list.body.items.length).toBe(1)
})

await check('program config is validated server-side', async () => {
  const a = await Agent.owner()
  expectStatus(await a.post('/api/programs', { name: 'x', type: 'points', config: { pointsPerUnit: 1.5 } }), 400, 'invalid_points_per_unit')
  expectStatus(await a.post('/api/programs', { name: 'x', type: 'stamps', config: { stampsRequired: 1 } }), 400, 'invalid_stamps_required')
  expectStatus(await a.post('/api/programs', { name: 'x', type: 'cashback' }), 400, 'validation_failed')
})

// ---------------------------------------------------------------- members
await check('members: create with Saudi local phone, normalized to E.164; duplicate returns existing id', async () => {
  const a = await Agent.owner()
  const m = await a.post('/api/members', { phone: '0551234567', name: 'سارة' })
  expectStatus(m, 201)
  expect(m.body.phone).toBe('+966551234567')
  const dup = await a.post('/api/members', { phone: '+966 55 123 4567' })
  expectStatus(dup, 409, 'member_exists')
  expect(dup.body.memberId).toBe(m.body.id)
  const found = await a.get('/api/members/lookup?phone=551234567')
  expectStatus(found, 200)
  expect(found.body.id).toBe(m.body.id)
})

await check('members: invalid phone rejected; search by phone digits and by name', async () => {
  const a = await Agent.owner()
  expectStatus(await a.post('/api/members', { phone: '12345' }), 400, 'validation_failed')
  await a.post('/api/members', { phone: '0561112233', name: 'Noura Ali' })
  await a.post('/api/members', { phone: '0569998877', name: 'Khalid' })
  const byDigits = await a.get('/api/members?q=1112')
  expect(byDigits.body.total).toBe(1)
  const byName = await a.get('/api/members?q=noura')
  expect(byName.body.total).toBe(1)
  const all = await a.get('/api/members?limit=1')
  expect(all.body.items.length).toBe(1)
  expect(all.body.total).toBe(2)
})

// ---------------------------------------------------------------- ledger
await check('earn computes points from the purchase; redeem debits; member view shows balance and history', async () => {
  const a = await Agent.owner()
  const p = await setupProgram(a, 'points', { pointsPerUnit: 1, unitMinor: 100 })
  const m = await setupMember(a)
  const e = await a.post('/api/ledger/earn', { programId: p.id, memberId: m.id, purchaseMinor: 12_550 }, { headers: { 'idempotency-key': key() } })
  expectStatus(e, 201)
  expect(e.body.entry.amount, 'earned').toBe(125)
  const r = await a.post('/api/ledger/redeem', { programId: p.id, memberId: m.id, points: 25 }, { headers: { 'idempotency-key': key() } })
  expectStatus(r, 201)
  expect(r.body.balance).toBe(100)
  const view = await a.get(`/api/members/${m.id}`)
  expect(view.body.accounts[0].balance).toBe(100)
  expect(view.body.accounts[0].lifetimeEarned).toBe(125)
  expect(view.body.entries.length).toBe(2)
})

await check('earn is idempotent per key; reusing a key for another request is refused', async () => {
  const a = await Agent.owner()
  const p = await setupProgram(a)
  const m = await setupMember(a)
  const k = key()
  const body = { programId: p.id, memberId: m.id, purchaseMinor: 5000 }
  const first = await a.post('/api/ledger/earn', body, { headers: { 'idempotency-key': k } })
  const second = await a.post('/api/ledger/earn', body, { headers: { 'idempotency-key': k } })
  expectStatus(first, 201)
  expectStatus(second, 200)
  expect(second.body.replayed).toBe(true)
  expect(second.body.entry.id).toBe(first.body.entry.id)
  const other = await a.post('/api/ledger/earn', { ...body, purchaseMinor: 6000 }, { headers: { 'idempotency-key': k } })
  expectStatus(other, 409, 'idempotency_mismatch')
  expectStatus(await a.post('/api/ledger/earn', body), 400, 'idempotency_key_required')
})

await check('redeem cannot overdraw; draft programs cannot earn; tiny purchases earn nothing', async () => {
  const a = await Agent.owner()
  const p = await setupProgram(a)
  const m = await setupMember(a)
  expectStatus(
    await a.post('/api/ledger/redeem', { programId: p.id, memberId: m.id, points: 1 }, { headers: { 'idempotency-key': key() } }),
    422,
    'insufficient_balance',
  )
  expectStatus(
    await a.post('/api/ledger/earn', { programId: p.id, memberId: m.id, purchaseMinor: 99 }, { headers: { 'idempotency-key': key() } }),
    422,
    'nothing_to_earn',
  )
  const draft = await a.post('/api/programs', { name: 'draft', type: 'points' })
  expectStatus(
    await a.post('/api/ledger/earn', { programId: draft.body.id, memberId: m.id, purchaseMinor: 1000 }, { headers: { 'idempotency-key': key() } }),
    422,
    'program_not_active',
  )
})

await check('stamps program: one stamp per qualifying visit', async () => {
  const a = await Agent.owner()
  const p = await setupProgram(a, 'stamps', { stampsPerVisit: 1, stampsRequired: 6, minPurchaseMinor: 1000 })
  const m = await setupMember(a)
  const e = await a.post('/api/ledger/earn', { programId: p.id, memberId: m.id, purchaseMinor: 4500 }, { headers: { 'idempotency-key': key() } })
  expectStatus(e, 201)
  expect(e.body.entry.amount).toBe(1)
})

await check('void reverses once; adjust requires a reason; both are audited actions for managers', async () => {
  const a = await Agent.owner()
  const p = await setupProgram(a)
  const m = await setupMember(a)
  const e = await a.post('/api/ledger/earn', { programId: p.id, memberId: m.id, purchaseMinor: 3000 }, { headers: { 'idempotency-key': key() } })
  const v = await a.post('/api/ledger/void', { entryId: e.body.entry.id, note: 'wrong customer' }, { headers: { 'idempotency-key': key() } })
  expectStatus(v, 201)
  expect(v.body.balance).toBe(0)
  expectStatus(await a.post('/api/ledger/void', { entryId: e.body.entry.id }, { headers: { 'idempotency-key': key() } }), 409, 'already_voided')
  expectStatus(
    await a.post('/api/ledger/adjust', { programId: p.id, memberId: m.id, points: 10 }, { headers: { 'idempotency-key': key() } }),
    400,
    'validation_failed',
  )
  const adj = await a.post(
    '/api/ledger/adjust',
    { programId: p.id, memberId: m.id, points: 10, note: 'goodwill gesture' },
    { headers: { 'idempotency-key': key() } },
  )
  expectStatus(adj, 201)
  const list = await a.get(`/api/ledger/entries?memberId=${m.id}`)
  expect(list.body.total).toBe(3)
  expect(list.body.items.find((x) => x.id === e.body.entry.id).voided).toBe(true)
  const summary = await a.get('/api/ledger/summary')
  expect(summary.body.points.outstanding).toBe(10)
  expect(summary.body.members).toBe(1)
})

await check('points and stamps are reported separately, never summed', async () => {
  const a = await Agent.owner()
  const pts = await setupProgram(a, 'points', { pointsPerUnit: 1, unitMinor: 100 })
  const stp = await setupProgram(a, 'stamps', { stampsPerVisit: 1, stampsRequired: 5 })
  const m = await setupMember(a)
  await a.post('/api/ledger/earn', { programId: pts.id, memberId: m.id, purchaseMinor: 5000 }, { headers: { 'idempotency-key': key() } })
  await a.post('/api/ledger/earn', { programId: stp.id, memberId: m.id, purchaseMinor: 5000 }, { headers: { 'idempotency-key': key() } })
  const s = await a.get('/api/ledger/summary')
  expect(s.body.points.earned, 'points.earned').toBe(50)
  expect(s.body.stamps.earned, 'stamps.earned').toBe(1)
  expect(s.body.stamps.outstanding, 'stamps.outstanding').toBe(1)
  const list = await a.get('/api/members')
  const balances = list.body.items[0].balances
  expect(balances.length).toBe(2)
  expect(balances.find((b) => b.type === 'points').balance).toBe(50)
  expect(balances.find((b) => b.type === 'stamps').balance).toBe(1)
})

// ---------------------------------------------------------------- RBAC
await check('cashier: can enroll, earn and redeem; cannot adjust, void, edit programs or manage staff', async () => {
  const owner = await Agent.owner()
  const p = await setupProgram(owner)
  const cashier = await Agent.staff(owner, 'cashier')
  expect(cashier.me.role).toBe('cashier')
  const m = await setupMember(cashier)
  const e = await cashier.post(
    '/api/ledger/earn',
    { programId: p.id, memberId: m.id, purchaseMinor: 2000, source: 'pos' },
    { headers: { 'idempotency-key': key() } },
  )
  expectStatus(e, 201)
  expectStatus(
    await cashier.post('/api/ledger/redeem', { programId: p.id, memberId: m.id, points: 5, source: 'pos' }, { headers: { 'idempotency-key': key() } }),
    201,
  )
  expectStatus(await cashier.post('/api/ledger/void', { entryId: e.body.entry.id }, { headers: { 'idempotency-key': key() } }), 403, 'forbidden')
  expectStatus(
    await cashier.post('/api/ledger/adjust', { programId: p.id, memberId: m.id, points: 5, note: 'nope nope' }, { headers: { 'idempotency-key': key() } }),
    403,
    'forbidden',
  )
  expectStatus(await cashier.post('/api/programs', { name: 'x', type: 'points' }), 403, 'forbidden')
  expectStatus(await cashier.get('/api/staff'), 403, 'forbidden')
})

await check('analyst: read-only', async () => {
  const owner = await Agent.owner()
  const p = await setupProgram(owner)
  const analyst = await Agent.staff(owner, 'analyst')
  expectStatus(await analyst.get('/api/programs'), 200)
  expectStatus(await analyst.get('/api/ledger/entries'), 200)
  expectStatus(await analyst.post('/api/members', { phone: phone() }), 403, 'forbidden')
  const m = await setupMember(owner)
  expectStatus(
    await analyst.post('/api/ledger/earn', { programId: p.id, memberId: m.id, purchaseMinor: 1000 }, { headers: { 'idempotency-key': key() } }),
    403,
    'forbidden',
  )
})

await check('manager can manage programs but only the owner manages staff', async () => {
  const owner = await Agent.owner()
  const manager = await Agent.staff(owner, 'manager')
  expectStatus(await manager.post('/api/programs', { name: 'm', type: 'stamps' }), 201)
  expectStatus(await manager.get('/api/staff'), 200)
  expectStatus(await manager.post('/api/staff', { email: `x-${key()}@example.test`, name: 'x', role: 'cashier', password: 'long-enough-1' }), 403, 'forbidden')
})

await check('removing staff signs them out immediately', async () => {
  const owner = await Agent.owner()
  const cashier = await Agent.staff(owner, 'cashier')
  expectStatus(await owner.delete(`/api/staff/${cashier.me.user.id}`), 200)
  expectStatus(await cashier.get('/api/auth/me'), 401, 'unauthenticated')
  expectStatus(await owner.delete(`/api/staff/${owner.me.user.id}`), 422, 'cannot_remove_self')
})

// ---------------------------------------------------------------- tenant isolation
await check('tenants cannot see or touch each other’s programs, members or entries', async () => {
  const a = await Agent.owner()
  const b = await Agent.owner()
  const pa = await setupProgram(a)
  const ma = await setupMember(a)
  const e = await a.post('/api/ledger/earn', { programId: pa.id, memberId: ma.id, purchaseMinor: 1000 }, { headers: { 'idempotency-key': key() } })
  expectStatus(await b.get(`/api/programs/${pa.id}`), 404, 'program_not_found')
  expectStatus(await b.get(`/api/members/${ma.id}`), 404, 'member_not_found')
  expectStatus(await b.patch(`/api/programs/${pa.id}`, { name: 'hijack' }), 404, 'program_not_found')
  expectStatus(
    await b.post('/api/ledger/earn', { programId: pa.id, memberId: ma.id, purchaseMinor: 1000 }, { headers: { 'idempotency-key': key() } }),
    404,
    'program_not_found',
  )
  expectStatus(await b.post('/api/ledger/void', { entryId: e.body.entry.id }, { headers: { 'idempotency-key': key() } }), 404, 'entry_not_found')
  const pb = await setupProgram(b)
  expectStatus(
    await b.post('/api/ledger/earn', { programId: pb.id, memberId: ma.id, purchaseMinor: 1000 }, { headers: { 'idempotency-key': key() } }),
    404,
    'member_not_found',
  )
  expect((await b.get('/api/ledger/entries')).body.total).toBe(0)
  expect((await b.get('/api/members')).body.total).toBe(0)
})

await check('the same idempotency key in two tenants does not collide', async () => {
  const a = await Agent.owner()
  const b = await Agent.owner()
  const k = key()
  for (const agent of [a, b]) {
    const p = await setupProgram(agent)
    const m = await setupMember(agent)
    expectStatus(await agent.post('/api/ledger/earn', { programId: p.id, memberId: m.id, purchaseMinor: 1000 }, { headers: { 'idempotency-key': k } }), 201)
  }
})

await import('./wallet.mjs')
await import('./campaigns.mjs')
await import('./billing.mjs')

process.exit(summary() ? 1 : 0)
