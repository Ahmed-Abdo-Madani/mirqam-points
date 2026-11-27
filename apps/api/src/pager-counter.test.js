import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createPagerCounter } from './pager-counter.js'
import { freshDb, seedTenant } from './testing.js'

const KEY = 'k'.repeat(48)
let db
let tenantId
let calls
let answer
let live
const json = (status, body) => ({ ok: status < 400, status, json: async () => body })

const pager = {
  status: async () => ({ trialAvailable: !live, subscription: live ? { tier: 'basic', status: 'trialing', active: true, branches: 1 } : null }),
}
const config = { posApiUrl: 'https://pos-api.example', posBridgeKey: KEY, publicUrl: 'https://loyalty.mirqam.sa' }
let counter

beforeAll(async () => {
  db = await freshDb()
  ;({ tenantId } = await seedTenant(db))
  counter = createPagerCounter({
    db,
    config,
    pager,
    fetcher: async (url, init) => {
      calls.push({ url: String(url), method: init.method, body: init.body ? JSON.parse(init.body) : undefined, auth: init.headers.authorization })
      return answer(String(url), init)
    },
  })
})
afterAll(async () => {
  await db?.close()
})
beforeEach(() => {
  calls = []
  live = true
  answer = () => json(200, {})
})

const posState = (brand = {}) => ({
  posTenantId: 'pos-1',
  plan: { tier: 'basic', plusFeatures: false, branchLimit: 1, allowedBranchIds: ['b1'] },
  settings: { enabled: true, sound: 'chime' },
  branches: [{ id: 'b1', name: 'Main', slug: 'main', active: true, inPlan: true, counterUrl: 'https://p.mirqam.sa/c/main' }],
  brand: { name: 'Shop', nameAr: null, logoUrl: null, primaryColor: '#0F766E', accentColor: '#F59E0B', ...brand },
})

describe('the pager inside Loyalty: overview', () => {
  it('no live plan: a clear "start the plan" answer, and the POS is never called', async () => {
    live = false
    const o = await counter.overview(tenantId)
    expect(o.status).toBe('no_plan')
    expect(o.plan.trialAvailable).toBe(true)
    expect(calls).toHaveLength(0)
    await expect(counter.requireLive(tenantId)).rejects.toMatchObject({ status: 409, code: 'pager_no_plan' })
  })

  it('plan live but the POS is still being set up: starting (not an error)', async () => {
    answer = () => json(404, { code: 'pager_not_linked' })
    expect((await counter.overview(tenantId)).status).toBe('starting')
    answer = () => json(403, { code: 'pager_off' })
    expect((await counter.overview(tenantId)).status).toBe('starting')
  })

  it('live: the POS state for this workspace, over the bridge key, plus the loyalty-side subscription', async () => {
    answer = (_url, init) => (init.method === 'PUT' ? json(200, posState().brand) : json(200, posState({ nameAr: 'متجر' })))
    const o = await counter.overview(tenantId)
    expect(o).toMatchObject({ status: 'live', subscription: { tier: 'basic', active: true }, plan: { tier: 'basic' }, branches: [{ id: 'b1' }] })
    expect(calls[0]).toMatchObject({ url: `https://pos-api.example/v1/loyalty-bridge/pager/${tenantId}`, method: 'GET', auth: `Bearer ${KEY}` })
  })

  it('first time: the customer page brand comes from the workspace (name, card colours); never over the owner’s changes', async () => {
    // The seeded workspace's active programme (its loyalty card) carries the colours.
    await db.query('UPDATE programs SET design = $2 WHERE tenant_id = $1', [tenantId, JSON.stringify({ background: '#112233', label: '#AABBCC' })])
    answer = (_url, init) => (init.method === 'PUT' ? json(200, { ...posState().brand, ...JSON.parse(init.body) }) : json(200, posState()))
    const o = await counter.overview(tenantId)
    const put = calls.find((c) => c.method === 'PUT')
    expect(put.url).toMatch(/\/brand$/)
    expect(put.body).toMatchObject({ primaryColor: '#112233', accentColor: '#AABBCC' })
    expect(typeof put.body.name).toBe('string')
    expect(o.brand.primaryColor).toBe('#112233')
    // Already changed by the owner (a logo, an Arabic name or another colour): left alone.
    calls = []
    answer = () => json(200, posState({ primaryColor: '#000000' }))
    await counter.overview(tenantId)
    expect(calls.some((c) => c.method === 'PUT')).toBe(false)
  })

  it('a real POS business (managedInPos): its live store brand is never filled from Loyalty', async () => {
    answer = () => json(200, { ...posState(), managedInPos: true })
    const o = await counter.overview(tenantId)
    expect(o.managedInPos).toBe(true)
    expect(calls.some((c) => c.method === 'PUT')).toBe(false)
    answer = () => json(403, { code: 'managed_in_pos' })
    await expect(counter.bridge(tenantId, 'PUT', '/brand', { name: 'x' })).rejects.toMatchObject({ status: 403, code: 'managed_in_pos' })
  })

  it('POS unreachable or timing out: 503 pager_unavailable (the page shows a retry)', async () => {
    answer = () => {
      throw new TypeError('fetch failed')
    }
    await expect(counter.overview(tenantId)).rejects.toMatchObject({ status: 503, code: 'pager_unavailable' })
    answer = () => json(502, { message: 'bad gateway' })
    await expect(counter.bridge(tenantId, 'GET', '/branches')).rejects.toMatchObject({ status: 503, code: 'pager_unavailable' })
  })

  it('passes on the codes the page explains, nothing else', async () => {
    answer = () => json(403, { code: 'pager_branch_limit', limit: 1 })
    await expect(counter.bridge(tenantId, 'POST', '/branches', { name: 'x' })).rejects.toMatchObject({ status: 403, code: 'pager_branch_limit' })
    answer = () => json(403, { code: 'pager_plus_required' })
    await expect(counter.bridge(tenantId, 'GET', '/reports/csv')).rejects.toMatchObject({ status: 403, code: 'pager_plus_required' })
    answer = () => json(401, { code: 'unauthenticated' })
    await expect(counter.bridge(tenantId, 'GET', '')).rejects.toMatchObject({ status: 503, code: 'pager_unavailable' })
  })

  it('without the bridge key configured: pager_unavailable, never a call', async () => {
    const off = createPagerCounter({ db, config: { ...config, posBridgeKey: '' }, pager, fetcher: async () => json(200, {}) })
    await expect(off.overview(tenantId)).rejects.toMatchObject({ status: 503, code: 'pager_unavailable' })
  })
})

describe('the pager inside Loyalty: nav (no POS call)', () => {
  it('says whether the pager is live and whether there is an active programme', async () => {
    await db.query('DELETE FROM pager_subscriptions')
    expect(await counter.nav(tenantId)).toEqual({ pagerLive: false, hasProgram: true })
    await db.query(
      "INSERT INTO pager_subscriptions (tenant_id, tier, branches, status, source, expires_at) VALUES ($1, 'basic', 1, 'trialing', 'trial', now() + interval '10 days')",
      [tenantId],
    )
    expect((await counter.nav(tenantId)).pagerLive).toBe(true)
    expect(calls).toHaveLength(0)
  })
})
