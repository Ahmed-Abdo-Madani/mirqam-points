/* HTTP battery: subscription state, history and webhook surface. Moyasar itself is not
   reachable from the gate, so checkout/settlement is covered by the unit suites. */
import { Agent, check, expect, expectStatus } from './harness.mjs'

await check('billing: every role sees subscription state; history and plans are owner-only', async () => {
  const owner = await Agent.owner()
  const cashier = await Agent.staff(owner, 'cashier')
  const state = await cashier.get('/api/billing/state')
  expectStatus(state, 200)
  expect(state.body.state).toBe('trial')
  expect(state.body.enforced).toBe(false)
  expectStatus(await owner.get('/api/billing/events'), 200)
  expectStatus(await cashier.get('/api/billing/events'), 403, 'forbidden')
  expectStatus(await cashier.get('/api/billing'), 403, 'forbidden')
  expectStatus(await new Agent().get('/api/billing/state'), 401)
})

await check('billing: events are tenant-isolated and the webhook ignores unknown invoices', async () => {
  const a = await Agent.owner()
  const b = await Agent.owner()
  expect((await a.get('/api/billing/events')).body.items).toEqual([])
  expect((await b.get('/api/billing/events')).body.items).toEqual([])
  const hook = await new Agent().post('/api/billing/moyasar/webhook', { type: 'payment_paid', data: { invoice_id: '00000000-0000-4000-8000-000000000000' } })
  expectStatus(hook, 200)
})

await check('billing: owner sets the WhatsApp number for subscription reminders; staff cannot', async () => {
  const owner = await Agent.owner()
  const cashier = await Agent.staff(owner, 'cashier')
  expect((await owner.get('/api/billing/contact')).body.phone).toBe(null)
  const set = await owner.put('/api/billing/contact', { phone: '0551234567' })
  expectStatus(set, 200)
  expect(set.body.phone).toBe('+966551234567')
  expect((await owner.get('/api/billing/contact')).body.phone).toBe('+966551234567')
  expectStatus(await owner.put('/api/billing/contact', { phone: '12' }), 400, 'validation_failed')
  expect((await owner.get('/api/billing/contact')).body.phone).toBe('+966551234567')
  expectStatus(await cashier.put('/api/billing/contact', { phone: '0551234568' }), 403, 'forbidden')
  expectStatus(await cashier.get('/api/billing/contact'), 403, 'forbidden')
  const other = await Agent.owner()
  expect((await other.get('/api/billing/contact')).body.phone).toBe(null)
  expect((await owner.put('/api/billing/contact', { phone: null })).body.phone).toBe(null)
  expect((await owner.get('/api/billing/contact')).body.phone).toBe(null)
})

await check('pager plan: owner-only, prices from the catalog, one trial per workspace, tenant-isolated', async () => {
  const a = await Agent.owner()
  const b = await Agent.owner()
  const cashier = await Agent.staff(a, 'cashier')
  expectStatus(await cashier.get('/api/billing/pager'), 403, 'forbidden')
  expectStatus(await cashier.post('/api/billing/pager/trial', { tier: 'basic' }), 403, 'forbidden')
  expectStatus(await new Agent().get('/api/billing/pager'), 401)
  const s = await a.get('/api/billing/pager')
  expectStatus(s, 200)
  const pick = (o, keys) => Object.fromEntries(keys.map((k) => [k, o?.[k]]))
  expect(pick(s.body, ['vatExcluded', 'trialDays', 'trialAvailable', 'withLoyalty', 'subscription'])).toEqual({
    vatExcluded: true,
    trialDays: 14,
    trialAvailable: true,
    withLoyalty: false,
    subscription: null,
  })
  expect(pick(s.body.prices.basic, ['monthly', 'yearly'])).toEqual({ monthly: 2900, yearly: 29000 })
  expect(pick(s.body.prices.plus, ['monthly', 'yearly'])).toEqual({ monthly: 4900, yearly: 49000 })
  expectStatus(await a.post('/api/billing/pager/trial', { tier: 'gold' }), 400, 'validation_failed')
  const trial = await a.post('/api/billing/pager/trial', { tier: 'plus' })
  expectStatus(trial, 200)
  // The gate has no POS API: the trial starts, the push waits for the lifecycle retry.
  expect(pick(trial.body.subscription, ['tier', 'status', 'active', 'posError'])).toEqual({
    tier: 'plus',
    status: 'trialing',
    active: true,
    posError: 'pos_bridge_unconfigured',
  })
  expectStatus(await a.post('/api/billing/pager/trial', { tier: 'basic' }), 409, 'pager_trial_used')
  const other = await b.get('/api/billing/pager')
  expect(pick(other.body, ['trialAvailable', 'subscription'])).toEqual({ trialAvailable: true, subscription: null })
  // Checkout needs the unified billing service, which the gate does not run.
  expectStatus(
    await a.post('/api/billing/pager/checkout', { tier: 'basic', cycle: 'monthly', branches: 1 }, { headers: { 'idempotency-key': 'pager-gate-1' } }),
    503,
    'billing_unavailable',
  )
})

await check('pager inside Loyalty: roles, "start the plan" before a plan, a plain unavailable when the POS cannot be reached', async () => {
  const owner = await Agent.owner()
  const manager = await Agent.staff(owner, 'manager')
  const cashier = await Agent.staff(owner, 'cashier')
  expectStatus(await new Agent().get('/api/pager'), 401)
  // Before a plan: every staff role sees the same clear answer, never an error.
  for (const who of [owner, manager, cashier]) {
    const o = await who.get('/api/pager')
    expectStatus(o, 200)
    expect(o.body.status).toBe('no_plan')
  }
  expect((await cashier.get('/api/pager/nav')).body.pagerLive).toBe(false)
  // Tickets: staff, but only with a live plan.
  expectStatus(await cashier.post('/api/pager/branches/b1/tickets', {}), 409, 'pager_no_plan')
  expectStatus(await cashier.post('/api/pager/tickets/t1/call', {}), 409, 'pager_no_plan')
  // Settings, branches, brand, reports: owner and manager only.
  expectStatus(await cashier.put('/api/pager/settings', { sound: 'bell' }), 403, 'forbidden')
  expectStatus(await cashier.post('/api/pager/branches', { name: 'Olaya' }), 403, 'forbidden')
  expectStatus(await cashier.put('/api/pager/brand', { name: 'X' }), 403, 'forbidden')
  expectStatus(await cashier.get('/api/pager/reports?from=2026-11-01&to=2026-11-07'), 403, 'forbidden')
  expectStatus(await manager.put('/api/pager/settings', { sound: 'bell' }), 409, 'pager_no_plan')
  // With a live plan and no POS reachable (the gate runs none): a plain, retryable answer.
  expectStatus(await owner.post('/api/billing/pager/trial', { tier: 'basic' }), 200)
  expect((await cashier.get('/api/pager/nav')).body.pagerLive).toBe(true)
  expectStatus(await cashier.get('/api/pager'), 503, 'pager_unavailable')
  expectStatus(await cashier.post('/api/pager/branches/b1/tickets', {}), 503, 'pager_unavailable')
  // Another workspace is untouched.
  const other = await Agent.owner()
  expect((await other.get('/api/pager')).body.status).toBe('no_plan')
})
