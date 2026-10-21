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
