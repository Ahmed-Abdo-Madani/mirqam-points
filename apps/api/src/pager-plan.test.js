import { createHmac } from 'node:crypto'
import { billingAmountMinor, PAGER_PLANS, pagerBillingCode, pagerBillingProducts, pagerBranchAddonCode, pagerPrice, pagerTotal } from '@mirqam-points/shared'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createRemoteBilling } from './billing-remote.js'
import { HttpError } from './http.js'
import { createPagerPlan, parsePagerCode } from './pager-plan.js'
import { freshDb, seedTenant } from './testing.js'

const KEY = 'k'.repeat(48)
const SECRET = 'whsec-test'
let db
let tenantId
let billingCalls
let posCalls
let billingAnswer
let posAnswer
let billing
let pager

const json = (status, body) => ({ ok: status < 400, status, json: async () => body })

beforeAll(async () => {
  db = await freshDb()
  ;({ tenantId } = await seedTenant(db))
  const {
    rows: [u],
  } = await db.query("INSERT INTO users (email, password_hash, name) VALUES ('pager-owner@example.test', 'x', 'Pager Owner') RETURNING id")
  await db.query("INSERT INTO memberships (tenant_id, user_id, role) VALUES ($1, $2, 'owner')", [tenantId, u.id])
  const config = {
    billingUrl: 'https://billing.example',
    billingApiKey: 'a'.repeat(64),
    billingWebhookSecret: SECRET,
    publicUrl: 'https://loyalty.mirqam.sa',
    posApiUrl: 'https://pos-api.example',
    posBridgeKey: KEY,
    trialDays: 14,
  }
  const fetcher = async (url, init) => {
    const u = String(url)
    const body = init.body ? JSON.parse(init.body) : null
    if (u.startsWith('https://pos-api.example')) {
      posCalls.push({ url: u, body, auth: init.headers.authorization })
      return posAnswer(body)
    }
    billingCalls.push({ url: u, body, method: init.method })
    return billingAnswer(u, body)
  }
  billing = createRemoteBilling({ db, config, HttpError, fetcher })
  pager = createPagerPlan({ db, config, billing, fetcher })
})
afterAll(async () => {
  await db?.close()
})
beforeEach(async () => {
  billingCalls = []
  posCalls = []
  billingAnswer = () => json(200, {})
  posAnswer = (body) => json(200, { posTenantId: 'pos-tenant-1', created: true, products: { pager: body.active } })
  await db.query('DELETE FROM pager_subscriptions')
  await db.query('DELETE FROM subscriptions')
})

describe('pager plan catalog (config)', () => {
  it('holds the owner-approved prices, per branch, excluding VAT', () => {
    expect(pagerPrice('basic', 'monthly')).toBe(2900)
    expect(pagerPrice('basic', 'yearly')).toBe(29000)
    expect(pagerPrice('plus', 'monthly')).toBe(4900)
    expect(pagerPrice('plus', 'yearly')).toBe(49000)
    expect(pagerPrice('basic', 'monthly', true)).toBe(1500)
    expect(pagerPrice('plus', 'monthly', true)).toBe(2500)
    expect(PAGER_PLANS.basic.freeWithPosAdvanced).toBe(true)
    expect(PAGER_PLANS.plus.freeWithPosAdvanced).toBe(false)
    // The iPhone lock-screen alert is listed as coming soon until the App Clip ships.
    expect(PAGER_PLANS.plus.comingSoon).toContain('liveActivity')
    for (const f of PAGER_PLANS.plus.comingSoon) expect(PAGER_PLANS.plus.features).toContain(f)
    expect(pagerTotal('plus', 'monthly', 3)).toBe(14700)
    expect(() => pagerTotal('plus', 'monthly', 0)).toThrow()
  })

  it('billing products carry VAT-inclusive amounts (billing treats amounts as VAT-inclusive)', () => {
    expect(billingAmountMinor(2900)).toBe(3335)
    const products = pagerBillingProducts()
    expect(products).toHaveLength(8)
    expect(products.find((p) => p.code === 'pager_basic').prices).toEqual({ monthly: 3335, yearly: 33350 })
    expect(products.find((p) => p.code === 'pager_plus_loyalty_branch')).toMatchObject({ kind: 'addon', prices: { monthly: 2875 } })
    for (const p of products) expect(parsePagerCode(p.code.replace(/_branch$/, ''))).toBeTruthy()
  })

  it('maps billing codes both ways', () => {
    expect(pagerBillingCode('plus', true)).toBe('pager_plus_loyalty')
    expect(pagerBranchAddonCode('basic')).toBe('pager_basic_branch')
    expect(parsePagerCode('pager_plus_loyalty')).toEqual({ tier: 'plus', withLoyalty: true })
    expect(parsePagerCode('loyalty')).toBeNull()
  })
})

describe('trial', () => {
  it('starts once, with no card, and switches the pager on in the POS', async () => {
    const s = await pager.startTrial(tenantId, 'basic')
    expect(s.subscription).toMatchObject({ tier: 'basic', status: 'trialing', source: 'trial', active: true, posLinked: true, posState: 'on' })
    expect(s.trialAvailable).toBe(false)
    expect(posCalls).toHaveLength(1)
    expect(posCalls[0].auth).toBe(`Bearer ${KEY}`)
    expect(posCalls[0].body).toMatchObject({
      loyaltyTenantId: tenantId,
      active: true,
      plan: 'basic',
      branches: 1,
      owner: { email: 'pager-owner@example.test' },
    })
    const days = (new Date(s.subscription.expiresAt) - Date.now()) / 86_400_000
    expect(days).toBeGreaterThan(13.9)
    expect(days).toBeLessThanOrEqual(14)
    await expect(pager.startTrial(tenantId, 'plus')).rejects.toMatchObject({ status: 409, code: 'pager_trial_used' })
  })

  it('a lapsed trial is ended by the lifecycle job and the POS product switched off', async () => {
    await pager.startTrial(tenantId, 'basic')
    await db.query("UPDATE pager_subscriptions SET expires_at = now() - interval '1 minute' WHERE tenant_id = $1", [tenantId])
    posCalls = []
    await pager.runLifecycle()
    expect(posCalls).toHaveLength(1)
    expect(posCalls[0].body).toMatchObject({ active: false, posTenantId: 'pos-tenant-1', until: null })
    const s = await pager.status(tenantId)
    expect(s.subscription).toMatchObject({ status: 'expired', active: false, posState: 'off' })
    posCalls = []
    await pager.runLifecycle()
    expect(posCalls).toHaveLength(0)
  })

  it('keeps a failed POS push and retries it', async () => {
    posAnswer = () => json(409, { code: 'pos_email_in_use' })
    await pager.startTrial(tenantId, 'basic')
    expect((await pager.status(tenantId)).subscription).toMatchObject({ posError: 'pos_email_in_use', posState: null })
    posAnswer = () => json(200, { posTenantId: 'pos-tenant-9' })
    await pager.runLifecycle()
    expect((await pager.status(tenantId)).subscription).toMatchObject({ posError: null, posState: 'on', posLinked: true })
  })
})

describe('checkout through mirqam-billing', () => {
  it('bills the sub-account pager:<tenant> with list prices and an add-on per extra branch', async () => {
    billingAnswer = (url) => (url.endsWith('/checkout-sessions') ? json(200, { id: 'cs_1', url: 'https://billing.example/pay/cs_1' }) : json(200, {}))
    const c = await pager.checkout(tenantId, { tier: 'plus', cycle: 'monthly', branches: 3, autoRenew: true }, 'req-1')
    expect(c).toEqual({ id: 'cs_1', url: 'https://billing.example/pay/cs_1', status: 'pending' })
    const call = billingCalls.find((x) => x.url.endsWith('/checkout-sessions'))
    expect(call.body).toMatchObject({
      plan: 'pager_plus',
      cycle: 'monthly',
      items: [{ plan: 'pager_plus_branch', quantity: 2 }],
      auto_renew: true,
      account: { ref: `pager:${tenantId}`, parent_ref: tenantId, email: 'pager-owner@example.test' },
    })
  })

  it('uses the with-Loyalty prices for a paid loyalty subscriber', async () => {
    await db.query("INSERT INTO subscriptions (tenant_id, cycle, expires_at, status) VALUES ($1, 'yearly', now() + interval '200 days', 'active')", [tenantId])
    const s = await pager.status(tenantId)
    expect(s.withLoyalty).toBe(true)
    expect(s.prices.basic.monthly).toBe(1500)
    await pager.checkout(tenantId, { tier: 'basic', cycle: 'yearly', branches: 1 }, 'req-2')
    const call = billingCalls.find((x) => x.url.endsWith('/checkout-sessions'))
    expect(call.body.plan).toBe('pager_basic_loyalty')
    expect(call.body.items).toBeUndefined()
  })

  it('rejects bad input', async () => {
    for (const bad of [
      { tier: 'gold', cycle: 'monthly' },
      { tier: 'basic', cycle: 'weekly' },
      { tier: 'basic', cycle: 'monthly', branches: 51 },
    ])
      await expect(pager.checkout(tenantId, bad, 'x')).rejects.toMatchObject({ status: 400 })
  })
})

describe('entitlement webhook', () => {
  const sign = (body) => {
    const t = Math.floor(Date.now() / 1000)
    return `t=${t},v1=${createHmac('sha256', SECRET).update(`${t}.${body}`).digest('hex')}`
  }
  const ent = (over = {}) => ({
    platform: 'loyalty',
    account_ref: `pager:${tenantId}`,
    status: 'active',
    plan: 'pager_plus',
    cycle: 'yearly',
    items: [{ code: 'pager_plus_branch', quantity: 1 }],
    active_until: new Date(Date.now() + 365 * 86_400_000).toISOString(),
    version: 10,
    ...over,
  })

  it('applies pager:<tenant> entitlements to the pager row, never to the loyalty subscription', async () => {
    const body = JSON.stringify({ type: 'entitlement.updated', data: ent() })
    await billing.hook(body, sign(body))
    const s = await pager.status(tenantId)
    expect(s.subscription).toMatchObject({ tier: 'plus', cycle: 'yearly', branches: 2, status: 'active', source: 'billing', active: true, posState: 'on' })
    expect((await db.query('SELECT 1 FROM subscriptions WHERE tenant_id = $1', [tenantId])).rows).toHaveLength(0)
    expect(posCalls[0].body).toMatchObject({ active: true, plan: 'plus', branches: 2 })
  })

  it('ignores older versions and switches the pager off when the subscription ends', async () => {
    await pager.applyEntitlement(ent({ version: 10 }))
    expect(await pager.applyEntitlement(ent({ version: 5, status: 'expired' }))).toBe(false)
    posCalls = []
    await pager.applyEntitlement(ent({ version: 11, status: 'suspended' }))
    expect((await pager.status(tenantId)).subscription).toMatchObject({ status: 'suspended', active: false, posState: 'off' })
    expect(posCalls[0].body).toMatchObject({ active: false })
  })

  it('a paid subscription replaces the trial', async () => {
    await pager.startTrial(tenantId, 'basic')
    await pager.applyEntitlement(ent({ version: 1, plan: 'pager_basic_loyalty', items: [] }))
    expect((await pager.status(tenantId)).subscription).toMatchObject({ source: 'billing', tier: 'basic', branches: 1 })
  })

  it('refuses refs that are not a workspace', async () => {
    expect(await pager.applyEntitlement(ent({ account_ref: 'pager:not-a-uuid' }))).toBe(false)
    expect(await pager.applyEntitlement(ent({ plan: 'loyalty' }))).toBe(false)
    expect(await billing.apply(ent())).toBe(false)
  })
})

describe('pager on/off follows the billing status', () => {
  const ent = (over = {}) => ({
    platform: 'loyalty',
    account_ref: `pager:${tenantId}`,
    status: 'active',
    plan: 'pager_basic',
    cycle: 'monthly',
    items: [],
    active_until: new Date(Date.now() + 30 * 86_400_000).toISOString(),
    version: 100,
    ...over,
  })
  const lastPush = () => posCalls.at(-1)?.body.active

  it('past_due keeps the pager on through the grace period', async () => {
    await pager.applyEntitlement(ent())
    await pager.applyEntitlement(ent({ version: 101, status: 'past_due', active_until: new Date(Date.now() + 7 * 86_400_000).toISOString() }))
    expect(lastPush()).toBe(true)
    expect((await pager.status(tenantId)).subscription).toMatchObject({ status: 'past_due', active: true, posState: 'on' })
    posCalls = []
    await pager.runLifecycle()
    expect(posCalls).toHaveLength(0)
  })

  it.each(['suspended', 'expired', 'canceled'])('%s switches the pager off', async (status) => {
    await pager.applyEntitlement(ent())
    await pager.applyEntitlement(ent({ version: 101, status, active_until: new Date(Date.now() - 1000).toISOString() }))
    expect(lastPush()).toBe(false)
    expect((await pager.status(tenantId)).subscription).toMatchObject({ status, active: false, posState: 'off' })
  })

  it('cancel at period end stays on until the period ends', async () => {
    await pager.applyEntitlement(ent({ cancel_at_period_end: true }))
    expect(lastPush()).toBe(true)
  })

  it('paying again after a lapse switches the pager back on', async () => {
    await pager.applyEntitlement(ent())
    await pager.applyEntitlement(ent({ version: 101, status: 'suspended', active_until: new Date(Date.now() - 1000).toISOString() }))
    await pager.applyEntitlement(ent({ version: 102 }))
    expect(lastPush()).toBe(true)
    expect((await pager.status(tenantId)).subscription).toMatchObject({ status: 'active', active: true, posState: 'on' })
  })

  it('a subscription paid during the trial is never switched off by the trial-end job', async () => {
    await pager.startTrial(tenantId, 'basic')
    await pager.applyEntitlement(ent({ version: 1 }))
    // The trial's original end passes.
    const later = new Date(Date.now() + 15 * 86_400_000)
    posCalls = []
    await pager.runLifecycle(later)
    expect(posCalls.filter((c) => c.body.active === false)).toHaveLength(0)
    expect((await pager.status(tenantId)).subscription).toMatchObject({ source: 'billing', status: 'active', active: true })
  })
})
