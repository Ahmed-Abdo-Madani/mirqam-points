import { createHmac } from 'node:crypto'
import {
  billingAmountMinor,
  PAGER_INCLUDED_WITH_LOYALTY,
  PAGER_MAX_BRANCHES,
  PAGER_PLANS,
  PAGER_TIERS,
  pagerBillingCode,
  pagerBillingProducts,
  pagerBranchAddonCode,
  pagerLoyaltyUpgrades,
  pagerPrice,
  pagerTotal,
} from '@mirqam-points/shared'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createRemoteBilling } from './billing-remote.js'
import { HttpError } from './http.js'
import { createPagerPlan, includedPlan, parsePagerCode } from './pager-plan.js'
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

  it('without paid Loyalty: the standalone prices and checkout, unchanged (290 / 490 yearly, both cycles)', async () => {
    const s = await pager.status(tenantId)
    expect(s.included).toBe(false)
    expect(s.cycles).toEqual(['monthly', 'yearly'])
    expect(s.prices.basic.yearly).toBe(29000)
    expect(s.prices.plus.yearly).toBe(49000)
    await pager.checkout(tenantId, { tier: 'plus', cycle: 'yearly', branches: 1 }, 'req-y-list')
    expect(billingCalls.find((x) => x.url.endsWith('/checkout-sessions')).body).toMatchObject({ plan: 'pager_plus', cycle: 'yearly' })
  })

  it('an existing with-Loyalty yearly subscription (if any) is applied and renews as it is', async () => {
    expect(
      await pager.applyEntitlement({
        platform: 'loyalty',
        account_ref: `pager:${tenantId}`,
        status: 'active',
        plan: 'pager_plus_loyalty',
        cycle: 'yearly',
        items: [],
        active_until: new Date(Date.now() + 300 * 86_400_000).toISOString(),
        version: 5,
      }),
    ).toBe(true)
    expect((await pager.status(tenantId)).subscription).toMatchObject({ tier: 'plus', cycle: 'yearly', status: 'active', active: true })
  })

  it('passes an HQ coupon to billing (a 100% coupon completes without a payment page)', async () => {
    billingAnswer = (url) => (url.endsWith('/checkout-sessions') ? json(200, { id: 'cs_free', done: true }) : json(200, {}))
    const c = await pager.checkout(tenantId, { tier: 'plus', cycle: 'monthly', branches: 1, coupon: ' PAGERTEST100 ' }, 'req-c')
    expect(c).toEqual({ id: 'cs_free', url: null, status: 'paid' })
    const call = billingCalls.find((x) => x.url.endsWith('/checkout-sessions'))
    expect(call.body).toMatchObject({ plan: 'pager_plus', coupon: 'PAGERTEST100' })
    // Done at once: the entitlement is re-read right away.
    expect(billingCalls.some((x) => x.url.includes(`/entitlements/${encodeURIComponent(`pager:${tenantId}`)}`))).toBe(true)
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

describe('paid Mirqam Loyalty: Basic included, Plus a paid upgrade (owner, 2026-11-28)', () => {
  const paid = (days = 200) =>
    db.query(
      "INSERT INTO subscriptions (tenant_id, cycle, expires_at, status) VALUES ($1, 'yearly', now() + make_interval(days => $2), 'active') ON CONFLICT (tenant_id) DO UPDATE SET expires_at = EXCLUDED.expires_at, status = 'active'",
      [tenantId, days],
    )
  const lapsed = () => db.query("UPDATE subscriptions SET expires_at = now() - interval '1 day', status = 'expired' WHERE tenant_id = $1", [tenantId])
  const lastPush = () => posCalls.at(-1)?.body
  const want = includedPlan()
  const upgrade = pagerLoyaltyUpgrades()[0]
  let version = 100
  const paidSub = (plan, { days = 20, cycle = 'monthly', extra = 0 } = {}) =>
    pager.applyEntitlement({
      platform: 'loyalty',
      account_ref: `pager:${tenantId}`,
      status: 'active',
      plan,
      cycle,
      items: extra ? [{ code: `${plan}_branch`, quantity: extra }] : [],
      active_until: new Date(Date.now() + days * 86_400_000).toISOString(),
      version: ++version,
    })
  const settleRow = async () => (await db.query('SELECT loyalty_action, included_since FROM pager_subscriptions WHERE tenant_id=$1', [tenantId])).rows[0]
  const calls = (suffix) => billingCalls.filter((c) => c.url.endsWith(suffix))

  it('the constant decides what is included (Basic, every branch) and what is sold on top (Plus)', () => {
    expect(PAGER_INCLUDED_WITH_LOYALTY.tier).toBe('basic')
    expect(want).toEqual({ tier: PAGER_INCLUDED_WITH_LOYALTY.tier, branches: PAGER_MAX_BRANCHES })
    expect(pagerLoyaltyUpgrades()).toEqual(PAGER_TIERS.slice(PAGER_TIERS.indexOf(PAGER_INCLUDED_WITH_LOYALTY.tier) + 1))
    expect(upgrade).toBe('plus')
  })

  it('paid Loyalty: Basic on, no subscription row needed, only the Plus upgrade offered at 25 / 250', async () => {
    await paid()
    const s0 = await pager.status(tenantId)
    expect(s0).toMatchObject({ included: true, includedTier: want.tier, upgrade, trialAvailable: false, purchasable: true, withLoyaltyPrice: true })
    expect(Object.keys(s0.prices)).toEqual([upgrade])
    expect(s0.prices[upgrade]).toMatchObject({ monthly: pagerPrice(upgrade, 'monthly', true), yearly: pagerPrice(upgrade, 'yearly', true) })
    expect(s0.prices.plus).toMatchObject({ monthly: 2500, yearly: 25000 })
    expect(s0.subscription).toMatchObject({ tier: want.tier, branches: want.branches, source: 'loyalty', active: true })
    expect((await db.query('SELECT 1 FROM pager_subscriptions WHERE tenant_id=$1', [tenantId])).rows).toHaveLength(0)
    // What is included is never sold (so pager_basic_loyalty is never sold), and there is no trial.
    await expect(pager.checkout(tenantId, { tier: want.tier, cycle: 'monthly', branches: 1 }, 'inc-1')).rejects.toMatchObject({
      status: 409,
      code: 'pager_included',
    })
    await expect(pager.startTrial(tenantId, 'basic')).rejects.toMatchObject({ status: 409, code: 'pager_included' })
    expect(calls('/checkout-sessions')).toHaveLength(0)
    // The first visit to the Pager tab makes the POS-side business through the bridge, on Basic.
    await pager.ensureIncluded(tenantId, { create: true })
    expect(lastPush()).toMatchObject({ active: true, plan: want.tier, branches: want.branches })
    expect((await db.query('SELECT source, status FROM pager_subscriptions WHERE tenant_id=$1', [tenantId])).rows[0]).toEqual({
      source: 'loyalty',
      status: 'active',
    })
  })

  it('the Plus upgrade checks out at the Loyalty price: pager_plus_loyalty + its branch add-on, both cycles', async () => {
    await paid()
    billingAnswer = (url) => (url.endsWith('/checkout-sessions') ? json(200, { id: 'cs_u', url: 'https://billing.example/pay/cs_u' }) : json(200, {}))
    await pager.checkout(tenantId, { tier: 'plus', cycle: 'yearly', branches: 3 }, 'up-1')
    await pager.checkout(tenantId, { tier: 'plus', cycle: 'monthly', branches: 1 }, 'up-2')
    const [y, m] = calls('/checkout-sessions').map((c) => c.body)
    expect(y).toMatchObject({ plan: pagerBillingCode('plus', true), cycle: 'yearly', items: [{ plan: pagerBranchAddonCode('plus', true), quantity: 2 }] })
    expect(m).toMatchObject({ plan: 'pager_plus_loyalty', cycle: 'monthly' })
    expect(JSON.stringify([y, m])).not.toContain('pager_basic')
  })

  it('a paid Plus on top of Loyalty runs Plus on the POS; when it ends, Basic stays on as included', async () => {
    await paid()
    await pager.ensureIncluded(tenantId, { create: true })
    await paidSub('pager_plus_loyalty', { extra: 1 })
    expect(lastPush()).toMatchObject({ active: true, plan: 'plus', branches: 2 })
    const s = await pager.status(tenantId)
    expect(s).toMatchObject({ included: true, upgrade: null, purchasable: false })
    expect(s.subscription).toMatchObject({ tier: 'plus', source: 'billing', active: true, withLoyaltyPrice: true })
    // Plus ends (not renewed) while Loyalty is still paid: back to the included Basic, no gap.
    await db.query("UPDATE pager_subscriptions SET status='expired', expires_at=now() - interval '1 minute' WHERE tenant_id=$1", [tenantId])
    posCalls = []
    await pager.runLifecycle()
    expect(lastPush()).toMatchObject({ active: true, plan: want.tier, branches: want.branches })
    expect((await pager.status(tenantId)).subscription).toMatchObject({ tier: want.tier, source: 'loyalty', active: true })
  })

  it('Loyalty on its free trial is not paid: the 14-day pager trial as today, standalone prices', async () => {
    const s0 = await pager.status(tenantId)
    expect(s0).toMatchObject({ included: false, trialAvailable: true, upgrade: null })
    expect(s0.prices.basic).toMatchObject({ monthly: 2900, yearly: 29000 })
    expect(s0.prices.plus).toMatchObject({ monthly: 4900, yearly: 49000 })
    expect((await pager.startTrial(tenantId, 'plus')).subscription).toMatchObject({ source: 'trial', status: 'trialing', active: true })
  })

  it('paying for Loyalty during the pager trial: Basic included at once, no gap', async () => {
    await pager.startTrial(tenantId, 'plus')
    await paid()
    posCalls = []
    await pager.ensureIncluded(tenantId)
    expect(posCalls.every((c) => c.body.active === true)).toBe(true)
    expect(lastPush()).toMatchObject({ active: true, plan: want.tier })
    expect((await pager.status(tenantId)).subscription).toMatchObject({ source: 'loyalty', tier: want.tier, active: true })
  })

  it('Loyalty lapses: pager off through the bridge, data kept, both ways back offered; paid again: on by itself', async () => {
    await paid()
    await pager.ensureIncluded(tenantId, { create: true })
    await lapsed()
    posCalls = []
    await pager.runLifecycle()
    expect(lastPush()).toMatchObject({ active: false, until: null })
    const off = await pager.status(tenantId)
    expect(off).toMatchObject({ included: false, lapsedFromLoyalty: true, trialAvailable: false, purchasable: true })
    expect(off.prices.basic).toMatchObject({ monthly: 2900, yearly: 29000 })
    expect((await db.query('SELECT pos_tenant FROM pager_subscriptions WHERE tenant_id=$1', [tenantId])).rows[0].pos_tenant).toBe('pos-tenant-1')
    await paid()
    posCalls = []
    await pager.runLifecycle()
    expect(lastPush()).toMatchObject({ active: true, plan: want.tier, posTenantId: 'pos-tenant-1' })
    expect((await pager.status(tenantId)).subscription).toMatchObject({ source: 'loyalty', active: true })
  })

  it('a Loyalty webhook moves the included pager at once (no wait for the lifecycle job)', async () => {
    await paid()
    await pager.ensureIncluded(tenantId, { create: true })
    posCalls = []
    await billing.apply({
      platform: 'loyalty',
      account_ref: tenantId,
      status: 'expired',
      cycle: 'yearly',
      active_until: new Date(Date.now() - 1000).toISOString(),
      version: 9e12,
    })
    expect(lastPush()).toMatchObject({ active: false })
  })

  it('an existing standalone BASIC subscription + paid Loyalty: renewal stopped once, never charged again, listed to settle by hand', async () => {
    await paidSub('pager_basic')
    await paid()
    billingCalls = []
    posCalls = []
    await pager.runLifecycle()
    expect(calls(`/subscriptions/${encodeURIComponent(`pager:${tenantId}`)}/cancel`)).toHaveLength(1)
    expect(billingCalls.some((c) => c.url.includes('/checkout-sessions') || c.url.includes('/change-plan'))).toBe(false)
    expect(lastPush()).toMatchObject({ active: true, plan: want.tier, branches: want.branches })
    expect(await settleRow()).toMatchObject({ loyalty_action: 'renewal_stopped' })
    expect((await pager.toSettle()).map((r) => [r.tenant_id, r.loyalty_action])).toEqual([[tenantId, 'renewal_stopped']])
    expect((await pager.status(tenantId)).subscription).toMatchObject({ source: 'loyalty', replacedSubscription: { tier: 'basic', renewalStopped: true } })
    billingCalls = []
    await pager.runLifecycle()
    expect(calls('/cancel')).toHaveLength(0)
  })

  it('an existing standalone PLUS subscription + paid Loyalty: keeps renewing as Plus, at the Loyalty price from its next renewal', async () => {
    await paidSub('pager_plus', { cycle: 'yearly', extra: 2 })
    await paid()
    billingCalls = []
    posCalls = []
    await pager.runLifecycle()
    const change = calls(`/subscriptions/${encodeURIComponent(`pager:${tenantId}`)}/change-plan`)
    expect(change.map((c) => c.body)).toEqual([{ plan: 'pager_plus_loyalty', cycle: 'yearly' }])
    expect(calls('/cancel')).toHaveLength(0)
    expect(billingCalls.some((c) => c.url.includes('/checkout-sessions') || c.url.includes('/charge'))).toBe(false)
    // Still Plus on the POS, on the branches paid for.
    expect(posCalls.every((c) => c.body.plan === 'plus')).toBe(true)
    expect(await settleRow()).toMatchObject({ loyalty_action: 'price_switched' })
    expect((await pager.toSettle()).map((r) => r.loyalty_action)).toEqual(['price_switched'])
    billingCalls = []
    await pager.runLifecycle()
    expect(calls('/change-plan')).toHaveLength(0)
    // The renewal at the Loyalty price arrives: nothing left to settle.
    await paidSub('pager_plus_loyalty', { cycle: 'yearly', extra: 2, days: 365 })
    expect(await settleRow()).toMatchObject({ loyalty_action: null })
    expect((await pager.status(tenantId)).subscription).toMatchObject({ tier: 'plus', withLoyaltyPrice: true, active: true })
  })

  it('Plus at the Loyalty price, Loyalty lapses: runs to its end at the price paid, 49 / 490 shown before any renewal; Loyalty paid again resumes it', async () => {
    await paid()
    await paidSub('pager_plus_loyalty', { days: 20 })
    await lapsed()
    billingCalls = []
    posCalls = []
    await pager.runLifecycle()
    expect(calls(`/subscriptions/${encodeURIComponent(`pager:${tenantId}`)}/cancel`)).toHaveLength(1)
    expect(billingCalls.some((c) => c.url.includes('/checkout-sessions') || c.url.includes('/change-plan'))).toBe(false)
    expect(posCalls.every((c) => c.body.active === true && c.body.plan === 'plus')).toBe(true)
    const s = await pager.status(tenantId)
    expect(s.subscription).toMatchObject({ tier: 'plus', active: true })
    expect(s.renewsAtStandalone).toMatchObject({ tier: 'plus', monthly: pagerPrice('plus', 'monthly'), yearly: pagerPrice('plus', 'yearly') })
    expect(s.renewsAtStandalone).toMatchObject({ monthly: 4900, yearly: 49000 })
    expect(await settleRow()).toMatchObject({ loyalty_action: 'stopped_on_lapse' })
    // Loyalty paid again before Plus ends: the renewal at the Loyalty price comes back.
    await paid()
    billingCalls = []
    await pager.runLifecycle()
    expect(calls(`/subscriptions/${encodeURIComponent(`pager:${tenantId}`)}/resume`)).toHaveLength(1)
    expect(await settleRow()).toMatchObject({ loyalty_action: null })
    expect((await pager.status(tenantId)).renewsAtStandalone).toBeNull()
  })

  it('Plus switched to the Loyalty price, Loyalty lapses before the renewal: the standalone price is kept (no charge now)', async () => {
    await paidSub('pager_plus')
    await paid()
    await pager.runLifecycle()
    await lapsed()
    billingCalls = []
    await pager.runLifecycle()
    expect(calls('/change-plan').map((c) => c.body)).toEqual([{ plan: 'pager_plus', cycle: 'monthly' }])
    expect(await settleRow()).toMatchObject({ loyalty_action: null })
  })

  it('without paid Loyalty, standalone checkout always uses the list codes', async () => {
    billingAnswer = (url) => (url.endsWith('/checkout-sessions') ? json(200, { id: 'cs_l', url: 'https://billing.example/pay/cs_l' }) : json(200, {}))
    await pager.checkout(tenantId, { tier: 'basic', cycle: 'yearly', branches: 2 }, 'list-codes')
    const body = calls('/checkout-sessions')[0].body
    expect(body).toMatchObject({ plan: 'pager_basic', items: [{ plan: 'pager_basic_branch', quantity: 1 }] })
    expect(JSON.stringify(body)).not.toContain('_loyalty')
  })
})
