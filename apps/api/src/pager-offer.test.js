import express from 'express'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { errorHandler } from './http.js'
import { createPagerOffer, installPagerOffer, pagerOfferRoutes, posBridgeGate } from './pager-offer.js'
import { freshDb, seedTenant } from './testing.js'

const KEY = 'b'.repeat(48)
let db
let tenantId
let programId
let allowed
let offer
let server
let base

const billing = { entitlement: async () => ({ allowed }) }
const wallet = { status: () => ({ apple: true, google: false }) }
const config = { publicUrl: 'https://loyalty.mirqam.sa' }

async function post(path, body, key = KEY) {
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(key ? { authorization: `Bearer ${key}` } : {}) },
    body: JSON.stringify(body),
  })
  return { status: res.status, body: await res.json().catch(() => ({})) }
}

beforeAll(async () => {
  db = await freshDb()
  ;({ tenantId, programId } = await seedTenant(db, { type: 'stamps' }))
  await db.query(`UPDATE programs SET name='Coffee', config='{"stampsPerVisit":1,"stampsRequired":8,"minPurchaseMinor":0}' WHERE id=$1`, [programId])
  offer = createPagerOffer({ db, config, billing, wallet })
  const app = express()
  app.use(express.json())
  installPagerOffer({ app, offer, env: { MIRQAM_POS_BRIDGE_KEY: KEY } })
  app.use(errorHandler)
  await new Promise((done) => {
    server = app.listen(0, '127.0.0.1', done)
  })
  base = `http://127.0.0.1:${server.address().port}`
})
afterAll(async () => {
  await new Promise((done) => server?.close(done))
  await db?.close()
})
beforeEach(() => {
  allowed = true
})

const join = (over = {}) => ({
  loyaltyTenantId: tenantId,
  programId,
  phone: '+971501234567',
  name: 'Sara',
  locale: 'en',
  marketingConsent: true,
  acceptTerms: true,
  ...over,
})

describe('pager offer: server to server from the POS API', () => {
  it('needs the bridge key; off when the key is not configured', async () => {
    expect((await post('/api/pos/pager/offer', { loyaltyTenantId: tenantId, programId }, null)).status).toBe(401)
    expect((await post('/api/pos/pager/offer', { loyaltyTenantId: tenantId, programId }, 'x'.repeat(48))).status).toBe(401)
    const res = { set() {}, status: (s) => ({ json: (b) => ({ s, b }) }) }
    expect(posBridgeGate({ MIRQAM_POS_BRIDGE_KEY: 'short' })({ get: () => '' }, res, () => 'next')).toEqual({ s: 503, b: { error: 'bridge_disabled' } })
  })

  it('offer check: active with the program while the plan is live; inactive when it lapses or is archived', async () => {
    const live = await post('/api/pos/pager/offer', { loyaltyTenantId: tenantId, programId })
    expect(live.status).toBe(200)
    expect(live.body).toMatchObject({ active: true, program: { id: programId, name: 'Coffee', type: 'stamps', config: { stampsRequired: 8 } } })
    allowed = false
    expect((await post('/api/pos/pager/offer', { loyaltyTenantId: tenantId, programId })).body).toEqual({ active: false })
    allowed = true
    const other = await seedTenant(db)
    // Another workspace's program is never offerable here.
    expect((await post('/api/pos/pager/offer', { loyaltyTenantId: tenantId, programId: other.programId })).body).toEqual({ active: false })
  })

  it('join: a new number becomes an unverified member with a pass, any country', async () => {
    const res = await post('/api/pos/pager/join', join())
    expect(res.status).toBe(201)
    expect(res.body.status).toBe('joined')
    expect(res.body.passUrl).toMatch(/^https:\/\/loyalty\.mirqam\.sa\/p\/[A-Za-z0-9_-]{24,}$/)
    expect(res.body.wallet.apple).toMatch(/\/apple\.pkpass$/)
    expect(res.body.wallet.google).toBeNull()
    const m = (await db.query('SELECT name, verified, marketing_consent, locale FROM members WHERE tenant_id=$1 AND phone=$2', [tenantId, '+971501234567']))
      .rows[0]
    expect(m).toEqual({ name: 'Sara', verified: false, marketing_consent: true, locale: 'en' })
    const audit = (await db.query("SELECT data FROM audit_log WHERE tenant_id=$1 AND action='member.joined_from_pager'", [tenantId])).rows
    expect(audit).toHaveLength(1)
    expect(JSON.stringify(audit[0].data)).not.toContain('971')
  })

  it('join: an existing member gets a neutral answer and never a pass', async () => {
    const again = await post('/api/pos/pager/join', join({ name: 'Someone else' }))
    expect(again.status).toBe(200)
    expect(again.body).toEqual({ status: 'already_member' })
  })

  it('join: terms box required, phone must be valid, program must be live', async () => {
    expect((await post('/api/pos/pager/join', join({ acceptTerms: false }))).status).toBe(400)
    const bad = await post('/api/pos/pager/join', join({ phone: '+9661234' }))
    expect(bad.status).toBe(400)
    allowed = false
    const lapsed = await post('/api/pos/pager/join', join({ phone: '+201001234567' }))
    expect(lapsed).toMatchObject({ status: 402, body: { error: 'loyalty_inactive' } })
    allowed = true
    await db.query("UPDATE programs SET status='archived' WHERE id=$1", [programId])
    const archived = await post('/api/pos/pager/join', join({ phone: '+201001234567' }))
    expect(archived).toMatchObject({ status: 404, body: { error: 'program_not_found' } })
    await db.query("UPDATE programs SET status='active' WHERE id=$1", [programId])
  })

  it('branch picker: only active programs; saving sends the snapshot to the POS bridge', async () => {
    const list = await offer.programs(tenantId)
    expect(list).toEqual([{ id: programId, name: 'Coffee', type: 'stamps' }])
    const calls = []
    const counter = {
      bridge: async (...args) => {
        calls.push(args)
        return { loyaltyOffer: { programId, name: 'Coffee' } }
      },
    }
    await offer.pick(tenantId, 'branch_1', { programId }, counter)
    expect(calls[0]).toEqual([tenantId, 'PUT', '/branches/branch_1/loyalty-offer', { programId, name: 'Coffee', type: 'stamps', stampsRequired: 8 }])
    await offer.pick(tenantId, 'branch_1', { programId: null }, counter)
    expect(calls[1][3]).toEqual({ programId: null })
    allowed = false
    await expect(offer.pick(tenantId, 'branch_1', { programId }, counter)).rejects.toMatchObject({ status: 409, code: 'program_not_offerable' })
    await expect(offer.pick(tenantId, '../x', { programId: null }, counter)).rejects.toMatchObject({ status: 404 })
  })
})

describe('Setup routes: country and WhatsApp alerts go to the POS bridge', () => {
  let srv
  let url
  const calls = []
  const live = true
  const counter = {
    requireLive: async () => {
      if (!live) throw Object.assign(new Error('pager_no_plan'), { status: 409 })
    },
    bridge: async (...args) => {
      calls.push(args)
      if (args[2] === '/whatsapp') return { allowed: true, linked: false, connected: false, status: 'not_linked' }
      if (args[2] === '/whatsapp/pair') return { qrDataUrl: 'data:image/png;base64,QR', status: 'pairing' }
      return { ok: true }
    },
  }
  beforeAll(async () => {
    const app = express()
    app.use(express.json())
    app.use((req, _res, next) => {
      req.auth = { tenantId, role: req.get('x-role') || 'owner' }
      next()
    })
    app.use('/api/pager', pagerOfferRoutes({ offer, counter }))
    app.use(errorHandler)
    await new Promise((done) => {
      srv = app.listen(0, '127.0.0.1', done)
    })
    url = `http://127.0.0.1:${srv.address().port}/api/pager`
  })
  afterAll(async () => {
    await new Promise((done) => srv?.close(done))
  })
  const send = async (method, path, body, role) => {
    const res = await fetch(`${url}${path}`, {
      method,
      headers: { 'content-type': 'application/json', ...(role ? { 'x-role': role } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
    return { status: res.status, body: await res.json().catch(() => ({})) }
  }

  it('country: ISO-2 only, saved through PUT /settings', async () => {
    expect((await send('PUT', '/country', { country: 'AE' })).status).toBe(200)
    expect(calls.at(-1)).toEqual([tenantId, 'PUT', '/settings', { country: 'AE' }])
    expect((await send('PUT', '/country', { country: 'uae' })).status).toBe(400)
  })

  it('whatsapp: state, pair (QR) and unlink pass through; cashiers cannot', async () => {
    expect((await send('GET', '/whatsapp')).body).toMatchObject({ allowed: true, status: 'not_linked' })
    const pair = await send('POST', '/whatsapp/pair', {})
    expect(pair.body.qrDataUrl).toMatch(/^data:image\/png/)
    expect(calls.at(-1)).toEqual([tenantId, 'POST', '/whatsapp/pair', {}])
    await send('POST', '/whatsapp/unlink', {})
    expect(calls.at(-1)).toEqual([tenantId, 'POST', '/whatsapp/unlink', {}])
    expect((await send('POST', '/whatsapp/pair', {}, 'cashier')).status).toBe(403)
    expect((await send('POST', '/whatsapp/pair', { phone: 'not a phone' })).status).toBe(400)
  })
})
