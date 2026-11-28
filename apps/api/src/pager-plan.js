/* Mirqam Pager plan (بيجر مرقام) on the loyalty platform.

   Two ways to have the pager (owner, 2026-11-28: "Basic included and Plus as a paid"):
   - With a paid Mirqam Loyalty plan (`hasPaidLoyalty`: active or expiring, or POS-managed): BASIC is
     INCLUDED (PAGER_INCLUDED_WITH_LOYALTY), with no pager subscription and no checkout. Tracked by a row
     with source 'loyalty' (made on the first visit to the Pager tab) so the POS push can be tracked and
     retried. PLUS is a paid upgrade for these workspaces at the with-Loyalty Plus price (25 / 250 per
     branch, `pager_plus_loyalty` + `pager_plus_loyalty_branch`). When Loyalty lapses the included pager
     turns off through the bridge (data kept on the POS side) and comes back on by itself when Loyalty is
     paid again.
   - STANDALONE for a business without paid Loyalty: Basic / Plus per branch, 14-day trial, checkout
     through mirqam-billing (platform "loyalty", sub-account `pager:<tenant>`, `<plan>_branch` add-ons).

   A paid pager subscription on a workspace that has (or later buys) paid Loyalty (loyalty_action):
   - Basic: never charged again; renewal stopped once, Basic stays on as included ('renewal_stopped').
   - Plus at 49 / 490: keeps renewing as Plus, at the Loyalty price from its next renewal (billing
     change-plan, scheduled; 'price_switched'). Its branch add-ons cannot be moved to the Loyalty add-on
     without a charge, so they are listed to settle by hand.
   - Plus at the Loyalty price, Loyalty lapses (owner rule, 2026-11-28): the paid period runs to its end at
     the price paid, then it renews at the standalone Plus price (49 / 490). The change is scheduled in
     billing for the next renewal ('standalone_scheduled'), so the Pager tab and billing's renewal notice
     (7 days monthly, 30 days yearly before the charge) both show the new price first. Never cancelled for
     this. Loyalty paid again before the renewal: the Loyalty price is kept. If billing cannot schedule a
     price rise without charging now, the renewal is stopped instead ('stopped_on_lapse') so nothing is
     charged unannounced, and the owner is shown 49 / 490 to subscribe again.
   - A standalone Basic still running on a workspace with paid Loyalty: Plus cannot be bought until it
     ends (409 pager_basic_running); a past-due one is ended at once so no retry charges it.
   Nothing is refunded automatically; every case is logged and listed in HQ admin.

   Entitlement → POS: every change pushes `active` to the POS API (POST /v1/loyalty-bridge/pager). A
   failed push is kept on the row and retried by the lifecycle job. */
import {
  PAGER_CYCLES,
  PAGER_INCLUDED_WITH_LOYALTY,
  PAGER_MAX_BRANCHES,
  PAGER_PLANS,
  PAGER_TIERS,
  PAGER_TRIAL_DAYS,
  pagerBillingCode,
  pagerBranchAddonCode,
  pagerLoyaltyUpgrades,
  pagerPrice,
} from '@mirqam-points/shared'
import { HttpError } from './http.js'
import { posManagedEntitlement } from './pos-bridge/native.mjs'

const DAY = 86_400_000
const LIVE = new Set(['trialing', 'active', 'past_due'])
const PREFIX = 'pager'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ref = (tenantId) => `${PREFIX}:${tenantId}`
const rank = (tier) => PAGER_TIERS.indexOf(tier)
// A Loyalty plan with no end date known here (should not happen): keep the included pager a year ahead.
const FAR = () => new Date(Date.now() + 365 * DAY)

/** `pager_plus_loyalty` → { tier: 'plus', withLoyalty: true }. Null for anything else (old codes still parse). */
export function parsePagerCode(code) {
  const m = /^pager_(basic|plus)(_loyalty)?$/.exec(String(code || ''))
  return m ? { tier: m[1], withLoyalty: Boolean(m[2]) } : null
}

/** What the included pager is, from the constant: the tier, on every branch. */
export const includedPlan = () => ({
  tier: PAGER_INCLUDED_WITH_LOYALTY.tier,
  branches: PAGER_INCLUDED_WITH_LOYALTY.branches ?? PAGER_MAX_BRANCHES,
})

export function createPagerPlan({ db, config, billing, fetcher = fetch, log = console }) {
  const bridgeReady = () => (config.posBridgeKey || '').length >= 32 && /^(https:\/\/|http:\/\/(localhost|127\.0\.0\.1)[:/])/.test(config.posApiUrl || '')

  /** Paid Mirqam Loyalty (not its trial): { until } or null. POS-managed workspaces count as paid. */
  async function paidLoyalty(tenantId) {
    // Loyalty kept on the POS subscription (made from the POS console) counts as paid. Checked here
    // because the unified-billing entitlement only knows the workspace's own subscription.
    const managed = await posManagedEntitlement(db, tenantId)
    if (managed?.allowed) return { until: managed.expiresAt ? new Date(managed.expiresAt) : FAR() }
    const s = await billing.state(tenantId)
    if (s.state === 'active' || s.state === 'expiring') return { until: s.expiresAt ? new Date(s.expiresAt) : FAR() }
    return null
  }

  async function row(tenantId, q = db) {
    return (await q.query('SELECT * FROM pager_subscriptions WHERE tenant_id=$1', [tenantId])).rows[0] || null
  }

  const live = (r, now = new Date()) => Boolean(r && LIVE.has(r.status) && new Date(r.expires_at) > now)
  /** A live paid subscription above what Loyalty includes (Plus). */
  const paidUpgrade = (r, now = new Date()) => Boolean(r?.source === 'billing' && live(r, now) && rank(r.tier) > rank(includedPlan().tier))

  /** What the POS should run for this workspace: a paid Plus, else the included Basic, else the row's own plan. */
  function effective(r, included, now = new Date()) {
    if (included && !paidUpgrade(r, now)) return { active: true, ...includedPlan(), until: included.until }
    if (live(r, now)) return { active: true, tier: r.tier, branches: r.branches, until: new Date(r.expires_at) }
    return { active: false, tier: r?.tier ?? 'basic', branches: r?.branches ?? 1, until: null }
  }

  /* Pushes the current state to the POS API. Never throws: the error is kept on the row and retried. */
  async function pushToPos(tenantId, included) {
    const r = await row(tenantId)
    if (!r) return null
    const want = effective(r, included === undefined ? await paidLoyalty(tenantId) : included)
    if (!bridgeReady()) {
      await db.query("UPDATE pager_subscriptions SET pos_error='pos_bridge_unconfigured' WHERE tenant_id=$1", [tenantId])
      return { ok: false, reason: 'pos_bridge_unconfigured' }
    }
    const t = (
      await db.query(
        `SELECT t.name, n.pos_tenant, u.email, u.name AS owner_name
           FROM tenants t
           LEFT JOIN pos_native_tenants n ON n.tenant_id = t.id
           LEFT JOIN LATERAL (SELECT u.email, u.name FROM memberships m JOIN users u ON u.id = m.user_id
                               WHERE m.tenant_id = t.id AND m.role = 'owner' ORDER BY m.created_at LIMIT 1) u ON true
          WHERE t.id = $1`,
        [tenantId],
      )
    ).rows[0]
    if (!t) return null
    let error = null
    let posTenant = r.pos_tenant || t.pos_tenant || null
    try {
      const res = await fetcher(`${config.posApiUrl}/v1/loyalty-bridge/pager`, {
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.timeout(15000),
        headers: { authorization: `Bearer ${config.posBridgeKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          loyaltyTenantId: tenantId,
          ...(posTenant ? { posTenantId: posTenant } : {}),
          active: want.active,
          plan: want.tier,
          branches: want.branches,
          until: want.active ? want.until.toISOString() : null,
          business: { name: t.name },
          owner: { email: t.email, name: t.owner_name || t.name },
        }),
      })
      const body = await res.json().catch(() => ({}))
      if (res.ok) posTenant = typeof body.posTenantId === 'string' ? body.posTenantId.slice(0, 100) : posTenant
      // 409 pager_tenant_exists: the POS already has this workspace's pager business but the link was lost.
      else error = res.status === 409 && body.code === 'pager_tenant_exists' ? 'pager_tenant_exists' : `pos_http_${res.status}`
    } catch {
      error = 'pos_unreachable'
    }
    await db.query(
      `UPDATE pager_subscriptions SET pos_tenant=$2, pos_error=$3,
         pos_state = CASE WHEN $3::text IS NULL THEN $4 ELSE pos_state END,
         pos_synced_at = CASE WHEN $3::text IS NULL THEN now() ELSE pos_synced_at END
       WHERE tenant_id=$1`,
      [tenantId, posTenant, error, want.active ? 'on' : 'off'],
    )
    return { ok: !error, reason: error }
  }

  /** One billing call for a paid subscription; false (logged, retried by the lifecycle job) when it fails. */
  async function billingStep(tenantId, what, fn) {
    return (await billingRead(tenantId, what, fn)) !== null
  }

  /** Like billingStep, but returns billing's answer ({} when empty), or null when the call failed. */
  async function billingRead(tenantId, what, fn) {
    if (!billing.remote || typeof fn !== 'function') return null
    try {
      return (await fn(ref(tenantId))) ?? {}
    } catch (err) {
      log.warn?.(`[pager] could not ${what} for ${ref(tenantId)}: ${err?.code || err?.message}`)
      return null
    }
  }

  /** A live standalone (paid) subscription Loyalty already includes, e.g. Basic: Plus waits until it ends. */
  const basicRunning = (r, now = new Date()) => Boolean(r?.source === 'billing' && live(r, now) && !paidUpgrade(r, now))

  /** Both add-on codes count as branches: a Plus renewed at the Loyalty price keeps its standalone add-ons. */
  function branchAddons(items, tier) {
    const list = Array.isArray(items) ? items : []
    const qty = (code) => list.filter((i) => i?.code === code).reduce((a, i) => a + Math.max(0, Number(i.quantity) || 0), 0)
    return { standalone: qty(pagerBranchAddonCode(tier, false)), loyalty: qty(pagerBranchAddonCode(tier, true)) }
  }

  async function markAction(tenantId, action) {
    await db.query(
      'UPDATE pager_subscriptions SET loyalty_action=$2, included_since = CASE WHEN $2::text IS NULL THEN NULL ELSE now() END, updated_at=now() WHERE tenant_id=$1',
      [tenantId, action],
    )
  }

  const describeRow = (r) => `${r.tier}${r.with_loyalty ? ' at the Loyalty price' : ''}, ${r.cycle ?? 'n/a'}, ${r.branches} branch`

  /**
   * Brings the row in line with the Loyalty plan. With paid Loyalty: no row yet → a 'loyalty' row (only
   * when `create`, i.e. the first visit to the Pager tab); a trial, a lapsed loyalty row or an ended paid
   * subscription → included at once (no gap); a paid subscription → see the header (loyalty_action).
   * Without paid Loyalty: a live 'loyalty' row lapses (pager off, data kept), and a paid Plus at the
   * Loyalty price stops renewing at that price. Pushes to the POS when what it should run changed.
   */
  async function ensureIncluded(tenantId, { create = false, now = new Date() } = {}) {
    const included = await paidLoyalty(tenantId)
    const r = await row(tenantId)
    if (included) {
      const { tier, branches } = includedPlan()
      if (!r) {
        if (!create) return { included }
        await db.query(
          `INSERT INTO pager_subscriptions(tenant_id,tier,branches,status,source,expires_at,updated_at)
           VALUES($1,$2,$3,'active','loyalty',$4,now()) ON CONFLICT (tenant_id) DO NOTHING`,
          [tenantId, tier, branches, included.until],
        )
        await pushToPos(tenantId, included)
        return { included }
      }
      if (r.source === 'trial' || r.source === 'loyalty' || (r.source === 'billing' && !live(r, now))) {
        const changed =
          r.source !== 'loyalty' || !live(r, now) || new Date(r.expires_at).getTime() !== included.until.getTime() || r.tier !== tier || r.branches !== branches
        if (changed) {
          await db.query(
            "UPDATE pager_subscriptions SET source='loyalty', status='active', tier=$2, branches=$3, expires_at=$4, loyalty_action=NULL, included_since=NULL, updated_at=now() WHERE tenant_id=$1",
            [tenantId, tier, branches, included.until],
          )
          if (r.pos_state !== 'on' || r.source !== 'loyalty' || r.pos_error || r.tier !== tier) await pushToPos(tenantId, included)
        }
        return { included }
      }
      // A live paid subscription on a workspace with paid Loyalty.
      if (!paidUpgrade(r, now)) {
        // Basic (or anything Loyalty already includes): never charge it again; Basic stays on as included.
        // Past due: a renewal invoice is open and billing would retry it, so end it now (billing voids it).
        const pastDue = r.status === 'past_due'
        const cancel = billing.subAccountCancel && ((x) => billing.subAccountCancel(x, pastDue ? { immediate: true } : {}))
        if (
          (r.loyalty_action !== 'renewal_stopped' || pastDue) &&
          (await billingStep(tenantId, pastDue ? 'end the past-due renewal' : 'stop the renewal', cancel))
        ) {
          await markAction(tenantId, 'renewal_stopped')
          log.warn?.(
            `[pager] settle by hand: ${ref(tenantId)} (${describeRow(r)}) is now included with paid Loyalty; ` +
              (pastDue ? 'ended now and its open renewal invoice voided' : 'renewal stopped') +
              ', nothing refunded',
          )
          await pushToPos(tenantId, included)
        }
        return { included }
      }
      // Plus at 49 / 490: keeps renewing as Plus, at the Loyalty price from its next renewal.
      if (!r.with_loyalty && r.loyalty_action !== 'price_switched') {
        const plan = { plan: pagerBillingCode(r.tier, true), cycle: r.cycle === 'yearly' ? 'yearly' : 'monthly' }
        if (await billingStep(tenantId, 'switch to the Loyalty Plus price', (x) => billing.subAccountChangePlan?.(x, plan))) {
          await markAction(tenantId, 'price_switched')
          log.warn?.(
            `[pager] settle by hand: ${ref(tenantId)} (${describeRow(r)}) renews at the Loyalty Plus price from its next renewal; nothing refunded` +
              (r.branches > 1 ? `; its ${r.branches - 1} branch add-on(s) still renew at the standalone price: move them by hand` : ''),
          )
        }
        return { included }
      }
      // Plus at the Loyalty price whose renewal was stopped by a lapse: Loyalty is paid again, renew as before.
      if (r.with_loyalty && r.loyalty_action === 'stopped_on_lapse' && (await billingStep(tenantId, 'resume the renewal', billing.subAccountResume))) {
        await markAction(tenantId, null)
        log.warn?.(`[pager] ${ref(tenantId)} (${describeRow(r)}): Loyalty paid again, renewal at the Loyalty Plus price resumed`)
      }
      // Plus at the Loyalty price scheduled to renew at 49 / 490 after a lapse: Loyalty is paid again, keep the Loyalty price.
      if (r.with_loyalty && r.loyalty_action === 'standalone_scheduled') {
        const plan = { plan: pagerBillingCode(r.tier, true), cycle: r.cycle === 'yearly' ? 'yearly' : 'monthly' }
        if (await billingStep(tenantId, 'keep the Loyalty Plus price', (x) => billing.subAccountChangePlan?.(x, plan))) {
          await markAction(tenantId, null)
          log.warn?.(`[pager] ${ref(tenantId)} (${describeRow(r)}): Loyalty paid again, the scheduled 49 / 490 renewal dropped`)
        }
      }
      return { included }
    }
    // No paid Loyalty: an included pager lapses (turned off on the POS, everything kept there).
    if (r?.source === 'loyalty' && live(r, now)) {
      await db.query("UPDATE pager_subscriptions SET status='expired', expires_at=$2, updated_at=now() WHERE tenant_id=$1", [tenantId, now])
      await pushToPos(tenantId, null)
      return { included: null }
    }
    if (paidUpgrade(r, now)) {
      // Plus at the Loyalty price: runs to its end at the price paid, then renews at 49 / 490 (scheduled in
      // billing for the next renewal, so its renewal notice and the Pager tab show the new price first).
      if (r.with_loyalty && r.loyalty_action !== 'stopped_on_lapse' && r.loyalty_action !== 'standalone_scheduled') {
        const plan = { plan: pagerBillingCode(r.tier, false), cycle: r.cycle === 'yearly' ? 'yearly' : 'monthly', atPeriodEnd: true }
        const quote = await billingRead(tenantId, 'preview the standalone Plus renewal', (x) => billing.subAccountPreviewPlan?.(x, plan))
        // Scheduled for the renewal with nothing charged now; an older billing answers with a charge now instead.
        const scheduled =
          quote !== null && Number(quote.total_minor ?? quote.amount_minor ?? 0) === 0 && !['upgrade', 'cycle_change', 'unchanged'].includes(quote.type)
        if (scheduled) {
          if (await billingStep(tenantId, 'schedule the standalone Plus price', (x) => billing.subAccountChangePlan?.(x, plan))) {
            await markAction(tenantId, 'standalone_scheduled')
            log.warn?.(
              `[pager] ${ref(tenantId)} (${describeRow(r)}): Loyalty lapsed; Plus runs to its end, then renews at the standalone price (scheduled)` +
                (r.branches > 1 ? '; its branch add-on(s) still renew at the Loyalty price: move them by hand' : ''),
            )
          }
        } else if (quote !== null && (await billingStep(tenantId, 'stop the Loyalty-price renewal', billing.subAccountCancel))) {
          // Billing would charge the difference now: stop the renewal instead, so nothing is charged unannounced.
          await markAction(tenantId, 'stopped_on_lapse')
          log.warn?.(
            `[pager] ${ref(tenantId)} (${describeRow(r)}): Loyalty lapsed; billing cannot schedule 49 / 490 for the renewal, renewal stopped, the owner is shown 49 / 490`,
          )
        }
      } else if (!r.with_loyalty && r.loyalty_action === 'price_switched') {
        // Switched to the Loyalty price but not renewed yet: keep the standalone price (billing drops the scheduled change).
        const plan = { plan: pagerBillingCode(r.tier, false), cycle: r.cycle === 'yearly' ? 'yearly' : 'monthly' }
        if (await billingStep(tenantId, 'keep the standalone Plus price', (x) => billing.subAccountChangePlan?.(x, plan))) await markAction(tenantId, null)
      }
    }
    return { included: null }
  }

  /** Applies a billing entitlement for `pager:<tenant>`. Older versions never overwrite newer ones. */
  async function applyEntitlement(ent) {
    const tenantId = String(ent?.account_ref || '').slice(PREFIX.length + 1)
    if (!String(ent?.account_ref || '').startsWith(`${PREFIX}:`) || !UUID.test(tenantId)) return false
    if (!(await db.query('SELECT 1 FROM tenants WHERE id=$1 AND closed_at IS NULL', [tenantId])).rows[0]) return false
    if (ent.status === 'none') return false
    const plan = parsePagerCode(ent.plan)
    if (!plan) return false
    // Count both add-on codes: billing's price switch changes only the plan, the add-ons keep their code.
    const addons = branchAddons(ent.items, plan.tier)
    const branches = Math.min(PAGER_MAX_BRANCHES, 1 + addons.standalone + addons.loyalty)
    const status = ['trialing', 'active', 'past_due', 'suspended', 'canceled', 'expired'].includes(ent.status) ? ent.status : 'expired'
    const until =
      LIVE.has(status) && ent.active_until ? new Date(ent.active_until) : new Date(Math.min(Date.now(), new Date(ent.active_until || Date.now()).getTime()))
    const changed = await db.tx(async (tx) => {
      await tx.query('SELECT id FROM tenants WHERE id=$1 FOR UPDATE', [tenantId])
      const prior = await row(tenantId, tx)
      if (prior && prior.source === 'billing' && Number(prior.billing_version) > Number(ent.version || 0)) return false
      // A renewal at the Loyalty price completes a price switch once no standalone add-on is left on it (until
      // then it stays listed to settle by hand); a renewal at the standalone price completes a lapse switch.
      const settled =
        (prior?.loyalty_action === 'price_switched' && plan.withLoyalty && addons.standalone === 0) ||
        (prior?.loyalty_action === 'standalone_scheduled' && !plan.withLoyalty)
      await tx.query(
        `INSERT INTO pager_subscriptions(tenant_id,tier,cycle,branches,with_loyalty,status,source,expires_at,billing_version,updated_at)
         VALUES($1,$2,$3,$4,$5,$6,'billing',$7,$8,now())
         ON CONFLICT(tenant_id) DO UPDATE SET tier=EXCLUDED.tier, cycle=EXCLUDED.cycle, branches=EXCLUDED.branches,
           with_loyalty=EXCLUDED.with_loyalty, status=EXCLUDED.status, source='billing', expires_at=EXCLUDED.expires_at,
           billing_version=EXCLUDED.billing_version, updated_at=now(),
           loyalty_action = CASE WHEN pager_subscriptions.source = 'billing' AND NOT $9 THEN pager_subscriptions.loyalty_action ELSE NULL END,
           included_since = CASE WHEN pager_subscriptions.source = 'billing' AND NOT $9 THEN pager_subscriptions.included_since ELSE NULL END`,
        [tenantId, plan.tier, ent.cycle === 'yearly' ? 'yearly' : 'monthly', branches, plan.withLoyalty, status, until, Number(ent.version || 0), settled],
      )
      return true
    })
    if (changed) {
      await pushToPos(tenantId)
      // Paid Loyalty at the same time (or lapsed): follow the rules in the header.
      await ensureIncluded(tenantId)
    }
    return changed
  }

  if (billing.remote && billing.onSubAccount) billing.onSubAccount(PREFIX, applyEntitlement)
  // A Loyalty plan changed (paid, renewed, lapsed): the included pager follows it at once.
  if (billing.onLoyaltyApplied) billing.onLoyaltyApplied((tenantId) => ensureIncluded(tenantId).catch(() => {}))

  /** What is sold to this workspace: with paid Loyalty only the upgrade (Plus) at the Loyalty price; else the standalone prices. */
  function offers(included) {
    const tiers = included ? pagerLoyaltyUpgrades() : PAGER_TIERS
    const out = {}
    for (const tier of tiers) {
      out[tier] = {
        monthly: pagerPrice(tier, 'monthly', Boolean(included)),
        yearly: pagerPrice(tier, 'yearly', Boolean(included)),
        freeWithPosAdvanced: PAGER_PLANS[tier].freeWithPosAdvanced,
      }
    }
    return { prices: out, cycles: PAGER_CYCLES, withLoyaltyPrice: Boolean(included) }
  }

  const subscriptionView = (r) => ({
    tier: r.tier,
    cycle: r.cycle,
    branches: r.branches,
    status: r.status,
    source: r.source,
    active: live(r),
    expiresAt: r.expires_at,
    posLinked: Boolean(r.pos_tenant),
    posState: r.pos_state,
    posError: r.pos_error,
    withLoyaltyPrice: Boolean(r.with_loyalty) || r.loyalty_action === 'price_switched',
  })

  return {
    applyEntitlement,
    pushToPos,
    ensureIncluded,
    paidLoyalty,

    async status(tenantId) {
      const included = await paidLoyalty(tenantId)
      const r = await row(tenantId)
      const upgraded = Boolean(included) && paidUpgrade(r)
      // A standalone Basic still running: Plus is sold once it ends (billing would treat it as a plan change).
      const waiting = Boolean(included) && basicRunning(r)
      const base = {
        ...offers(included),
        currency: 'SAR',
        vatExcluded: true,
        trialDays: PAGER_TRIAL_DAYS,
        maxBranches: PAGER_MAX_BRANCHES,
        // With paid Loyalty: Basic included, no trial; Plus offered (once) at the Loyalty price.
        included: Boolean(included),
        includedTier: included ? includedPlan().tier : null,
        upgrade: included && !upgraded && !waiting ? (pagerLoyaltyUpgrades()[0] ?? null) : null,
        basicRunning: waiting ? { tier: r.tier, until: r.expires_at } : null,
        trialAvailable: !included && !r,
        purchasable: Boolean(billing.remote && billing.ready) && (!included || (!upgraded && !waiting && pagerLoyaltyUpgrades().length > 0)),
        checkoutHost: billing.checkoutHost || null,
        // An included pager whose Loyalty plan lapsed: the page offers both ways back.
        lapsedFromLoyalty: !included && r?.source === 'loyalty' && !live(r),
        // Plus at the Loyalty price after a lapse: runs to its end, then renews (scheduled: true) at the
        // standalone price, shown here before the charge; scheduled: false when its renewal was stopped instead.
        renewsAtStandalone:
          !included && paidUpgrade(r) && (r.loyalty_action === 'stopped_on_lapse' || r.loyalty_action === 'standalone_scheduled')
            ? {
                tier: r.tier,
                until: r.expires_at,
                cycle: r.cycle,
                scheduled: r.loyalty_action === 'standalone_scheduled',
                monthly: pagerPrice(r.tier, 'monthly'),
                yearly: pagerPrice(r.tier, 'yearly'),
              }
            : null,
      }
      if (included && !upgraded) {
        const { tier, branches } = includedPlan()
        return {
          ...base,
          subscription: {
            tier,
            cycle: null,
            branches,
            status: 'active',
            source: 'loyalty',
            active: true,
            expiresAt: included.until,
            posLinked: Boolean(r?.pos_tenant),
            posState: r?.pos_state ?? null,
            posError: r?.pos_error ?? null,
            // A paid Basic subscription Loyalty took over: still listed until its period ends.
            ...(r?.source === 'billing'
              ? { replacedSubscription: { tier: r.tier, cycle: r.cycle, expiresAt: r.expires_at, renewalStopped: r.loyalty_action === 'renewal_stopped' } }
              : {}),
          },
        }
      }
      return { ...base, subscription: r && subscriptionView(r) }
    },

    /** Starts the one free trial (no card). Turns the pager on in the POS right away. Not with paid Loyalty (Basic is included). */
    async startTrial(tenantId, tier) {
      if (!PAGER_TIERS.includes(tier)) throw new HttpError(400, 'validation_failed')
      if (await paidLoyalty(tenantId)) throw new HttpError(409, 'pager_included')
      const inserted = (
        await db.query(
          `INSERT INTO pager_subscriptions(tenant_id,tier,branches,status,source,expires_at,trial_started_at)
           VALUES($1,$2,1,'trialing','trial',now() + make_interval(days => $3),now())
           ON CONFLICT (tenant_id) DO NOTHING RETURNING tenant_id`,
          [tenantId, tier, PAGER_TRIAL_DAYS],
        )
      ).rows[0]
      if (!inserted) throw new HttpError(409, 'pager_trial_used')
      await pushToPos(tenantId, null)
      return this.status(tenantId)
    },

    /** Checkout. Without paid Loyalty: the standalone codes. With paid Loyalty: only the upgrade (Plus) at the
        Loyalty price (`pager_plus_loyalty`); what is included (Basic) is refused, so pager_basic_loyalty is never sold. */
    async checkout(tenantId, { tier, cycle, branches, coupon, autoRenew }, requestKey, returnBase) {
      const n = Number(branches ?? 1)
      if (!PAGER_TIERS.includes(tier) || !PAGER_CYCLES.includes(cycle) || !Number.isInteger(n) || n < 1 || n > PAGER_MAX_BRANCHES)
        throw new HttpError(400, 'validation_failed')
      const withLoyalty = Boolean(await paidLoyalty(tenantId))
      if (withLoyalty && !pagerLoyaltyUpgrades().includes(tier)) throw new HttpError(409, 'pager_included')
      if (withLoyalty) {
        // A standalone Basic still running: billing would route the Plus checkout to a plan change (a
        // downgrade by price, or a wrong proration). Plus is bought once it ends.
        const cur = await row(tenantId)
        if (basicRunning(cur)) throw new HttpError(409, 'pager_basic_running', { until: new Date(cur.expires_at).toISOString() })
      }
      if (!billing.remote || !billing.subAccountCheckout) throw new HttpError(503, 'billing_unavailable')
      const r = await billing.subAccountCheckout(
        tenantId,
        ref(tenantId),
        {
          plan: pagerBillingCode(tier, withLoyalty),
          cycle,
          items: n > 1 ? [{ plan: pagerBranchAddonCode(tier, withLoyalty), quantity: n - 1 }] : [],
          // HQ coupons (e.g. a 100% test coupon) are checked by billing against the pager_* plan codes.
          coupon: typeof coupon === 'string' && coupon.trim() ? coupon.trim().slice(0, 40) : undefined,
          autoRenew,
          returnBase,
        },
        requestKey,
      )
      const done = Boolean(r.done || r.completed)
      if (done) await this.sync(tenantId).catch(() => {})
      return { id: r.id || null, url: done ? null : r.url, status: done ? 'paid' : 'pending' }
    },

    /** Re-reads the billing entitlement (return from the payment page, missed webhooks). */
    async sync(tenantId) {
      if (!billing.remote || !billing.subAccountEntitlement) return false
      return applyEntitlement(await billing.subAccountEntitlement(ref(tenantId)))
    },

    /** HQ admin: paid pager subscriptions the Loyalty rules changed (nothing refunded): settle by hand. */
    async toSettle() {
      return (
        await db.query(
          `SELECT p.tenant_id, t.name, p.tier, p.cycle, p.branches, p.with_loyalty, p.status, p.expires_at, p.included_since, p.loyalty_action
             FROM pager_subscriptions p JOIN tenants t ON t.id = p.tenant_id
            WHERE p.source = 'billing' AND p.loyalty_action IS NOT NULL
            ORDER BY p.included_since DESC LIMIT 200`,
        )
      ).rows
    },

    /* Lifecycle job: ends lapsed trials, follows the Loyalty plan (included, lapse, comeback, paid subscriptions),
       and retries POS pushes that failed or are out of date. */
    async runLifecycle(now = new Date()) {
      await db.query("UPDATE pager_subscriptions SET status='expired', updated_at=now() WHERE source='trial' AND status='trialing' AND expires_at <= $1", [now])
      const due = (
        await db.query(
          `SELECT tenant_id FROM pager_subscriptions
            WHERE source = 'loyalty'
               OR (source = 'trial' AND status = 'trialing')
               OR (source = 'billing' AND status IN ('trialing','active','past_due'))
               OR pos_error IS NOT NULL
               OR pos_state IS NULL
               OR (pos_state = 'on') <> (status IN ('trialing','active','past_due') AND expires_at > $1)
               OR (source = 'billing' AND (updated_at < $2 OR expires_at < $3))
            ORDER BY updated_at LIMIT 200`,
          [now, new Date(now.getTime() - 6 * 3_600_000), new Date(now.getTime() + DAY)],
        )
      ).rows
      let pushed = 0
      let failed = 0
      for (const { tenant_id } of due) {
        // One workspace failing (database, billing, POS) never stops the rest of the batch.
        try {
          const r0 = await row(tenant_id)
          if (r0?.source === 'billing') await this.sync(tenant_id).catch(() => {})
          const { included } = await ensureIncluded(tenant_id, { now })
          const r = await row(tenant_id)
          const want = effective(r, included, now)
          const stale = r && (r.pos_error || !r.pos_state || (r.pos_state === 'on') !== want.active)
          if (stale && (await pushToPos(tenant_id, included))?.ok) pushed += 1
        } catch (err) {
          failed += 1
          log.error?.(`[pager] lifecycle failed for ${ref(tenant_id)}: ${err?.code || err?.message}`)
        }
      }
      return { pagerPushed: pushed, ...(failed ? { pagerFailed: failed } : {}) }
    },
  }
}
