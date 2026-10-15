/* HTTP battery: campaigns (wallet-pass notifications) and the no-bill stamp earn. */
import { Agent, check, expect, expectStatus, key, passJsonFrom, phone, uniq } from './harness.mjs'

const hdr = (k = key()) => ({ headers: { 'idempotency-key': k } })

async function program(owner, type = 'stamps', config = { stampsPerVisit: 1, stampsRequired: 8 }) {
  const p = await owner.post('/api/programs', { name: `Club ${uniq()}`, type, config })
  expectStatus(p, 201)
  expectStatus(await owner.patch(`/api/programs/${p.body.id}`, { status: 'active' }), 200)
  return p.body
}

async function member(owner, prog, marketingConsent) {
  const m = await owner.post('/api/members', { phone: phone(), name: 'Noura', marketingConsent })
  expectStatus(m, 201)
  const acct = await owner.post(`/api/members/${m.body.id}/accounts`, { programId: prog.id })
  expectStatus(acct, 201)
  return { member: m.body, token: acct.body.passPath.split('/').pop() }
}

const campaign = (prog, extra = {}) => ({ programId: prog.id, title: 'Weekend offer', body: 'Double stamps this Friday', ...extra })

// ---------------------------------------------------------------- stamp without a bill
await check('stamp card earns a flat stamp with no bill amount', async () => {
  const owner = await Agent.owner()
  const prog = await program(owner)
  const { member: m } = await member(owner, prog, false)
  const res = await owner.post('/api/ledger/earn', { programId: prog.id, memberId: m.id, source: 'pos' }, hdr())
  expectStatus(res, 201)
  expect(res.body.entry.amount).toBe(1)
  expect(res.body.entry.purchaseMinor).toBe(null)
  expect(res.body.balance).toBe(1)
})

await check('earn without a bill is refused for points programs and stamp programs with a minimum', async () => {
  const owner = await Agent.owner()
  const points = await program(owner, 'points', { pointsPerUnit: 1, unitMinor: 100 })
  const minimum = await program(owner, 'stamps', { stampsPerVisit: 1, stampsRequired: 8, minPurchaseMinor: 2000 })
  for (const prog of [points, minimum]) {
    const { member: m } = await member(owner, prog, false)
    expectStatus(await owner.post('/api/ledger/earn', { programId: prog.id, memberId: m.id }, hdr()), 422, 'purchase_required')
  }
})

// ---------------------------------------------------------------- campaigns
await check('campaign reaches consenting members only and puts the message on the pass', async () => {
  const owner = await Agent.owner()
  const prog = await program(owner)
  const yes = await member(owner, prog, true)
  const no = await member(owner, prog, false)

  const audience = await owner.get(`/api/campaigns/audience?programId=${prog.id}`)
  expectStatus(audience, 200)
  expect(audience.body.recipients).toBe(1)
  expect(audience.body.sendsLeft).toBe(3)

  const sent = await owner.post('/api/campaigns', campaign(prog), hdr())
  expectStatus(sent, 201)
  expect(sent.body.campaign.recipients).toBe(1)

  const read = async (t) => {
    const pk = await new Agent().request('GET', `/api/public/pass/${t}/apple.pkpass`, { binary: true })
    expectStatus(pk, 200)
    return passJsonFrom(pk.body).storeCard.backFields
  }
  const field = (await read(yes.token)).find((f) => f.key === 'message')
  expect(field.label).toBe('Weekend offer')
  expect(field.value).toBe('Double stamps this Friday')
  expect(field.changeMessage).toBe('%@')
  expect((await read(no.token)).some((f) => f.key === 'message')).toBe(false)

  const list = await owner.get('/api/campaigns')
  expectStatus(list, 200)
  expect(list.body.items[0].id).toBe(sent.body.campaign.id)
  expectStatus(await owner.get(`/api/campaigns/${sent.body.campaign.id}`), 200)
})

await check('campaign marks Apple devices as updated so Wallet re-fetches the pass', async () => {
  const owner = await Agent.owner()
  const prog = await program(owner)
  const { token } = await member(owner, prog, true)
  const pk = await new Agent().request('GET', `/api/public/pass/${token}/apple.pkpass`, { binary: true })
  const pass = passJsonFrom(pk.body)
  const base = `/api/wallet/apple/v1/devices/device-${uniq()}/registrations/${pass.passTypeIdentifier}`
  const auth = { authorization: `ApplePass ${pass.authenticationToken}` }
  const device = new Agent()
  expectStatus(await device.request('POST', `${base}/${pass.serialNumber}`, { body: { pushToken: 'push-1' }, headers: auth }), 201)
  const tag = (await device.get(`${base}?passesUpdatedSince=0`)).body.lastUpdated
  await new Promise((r) => setTimeout(r, 20))
  expectStatus(await owner.post('/api/campaigns', campaign(prog), hdr()), 201)
  const after = await device.get(`${base}?passesUpdatedSince=${tag}`)
  expectStatus(after, 200)
  expect(after.body.serialNumbers[0]).toBe(pass.serialNumber)
})

await check('campaign send is idempotent and rejects a reused key with different content', async () => {
  const owner = await Agent.owner()
  const prog = await program(owner)
  await member(owner, prog, true)
  const k = key()
  const first = await owner.post('/api/campaigns', campaign(prog), hdr(k))
  expectStatus(first, 201)
  const again = await owner.post('/api/campaigns', campaign(prog), hdr(k))
  expectStatus(again, 200)
  expect(again.body.replayed).toBe(true)
  expect(again.body.campaign.id).toBe(first.body.campaign.id)
  expectStatus(await owner.post('/api/campaigns', campaign(prog, { body: 'Different' }), hdr(k)), 409, 'idempotency_mismatch')
  expectStatus(await owner.post('/api/campaigns', campaign(prog)), 400, 'idempotency_key_required')
  expect((await owner.get('/api/campaigns')).body.total).toBe(1)
})

await check('campaign audience "all" includes members without marketing consent', async () => {
  const owner = await Agent.owner()
  const prog = await program(owner)
  await member(owner, prog, true)
  await member(owner, prog, false)
  const sent = await owner.post('/api/campaigns', campaign(prog, { audience: 'all' }), hdr())
  expectStatus(sent, 201)
  expect(sent.body.campaign.recipients).toBe(2)
})

await check('campaign validation: empty audience, bad copy, unknown or archived program, daily limit', async () => {
  const owner = await Agent.owner()
  const prog = await program(owner)
  expectStatus(await owner.post('/api/campaigns', campaign(prog), hdr()), 422, 'no_recipients')
  await member(owner, prog, true)
  expectStatus(await owner.post('/api/campaigns', campaign(prog, { title: '' }), hdr()), 400, 'validation_failed')
  expectStatus(await owner.post('/api/campaigns', campaign(prog, { body: 'x'.repeat(201) }), hdr()), 400, 'validation_failed')
  expectStatus(await owner.post('/api/campaigns', campaign({ id: '00000000-0000-4000-8000-000000000000' }), hdr()), 404, 'program_not_found')
  for (let i = 0; i < 3; i++) expectStatus(await owner.post('/api/campaigns', campaign(prog, { body: `Offer ${i}` }), hdr()), 201)
  expectStatus(await owner.post('/api/campaigns', campaign(prog, { body: 'One too many' }), hdr()), 429, 'campaign_rate_limited')
  expect((await owner.get(`/api/campaigns/audience?programId=${prog.id}`)).body.sendsLeft).toBe(0)
  expectStatus(await owner.patch(`/api/programs/${prog.id}`, { status: 'archived' }), 200)
  expectStatus(await owner.post('/api/campaigns', campaign(prog), hdr()), 422, 'program_not_active')
})

await check('campaigns are manager-only and tenant-isolated', async () => {
  const owner = await Agent.owner()
  const other = await Agent.owner()
  const prog = await program(owner)
  await member(owner, prog, true)
  const sent = await owner.post('/api/campaigns', campaign(prog), hdr())
  expectStatus(sent, 201)
  const cashier = await Agent.staff(owner, 'cashier')
  expectStatus(await cashier.get('/api/campaigns'), 403, 'forbidden')
  expectStatus(await cashier.post('/api/campaigns', campaign(prog), hdr()), 403, 'forbidden')
  expectStatus(await new Agent().get('/api/campaigns'), 401)
  expectStatus(await other.get(`/api/campaigns/${sent.body.campaign.id}`), 404, 'campaign_not_found')
  expectStatus(await other.post('/api/campaigns', campaign(prog), hdr()), 404, 'program_not_found')
  expect((await other.get('/api/campaigns')).body.total).toBe(0)
  const manager = await Agent.staff(owner, 'manager')
  expectStatus(await manager.get('/api/campaigns'), 200)
})
