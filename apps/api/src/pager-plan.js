/* Mirqam Pager plan (بيجر مرقام) on the loyalty platform.

   Two ways to have the pager (owner, 2026-11-28):
   - INCLUDED with a paid Mirqam Loyalty plan (`hasPaidLoyalty`: active or expiring, or POS-managed): no
     pager subscription, no checkout. What is included is PAGER_INCLUDED_WITH_LOYALTY. Tracked by a row
     with source 'loyalty' (made on the first visit to the Pager tab) so the POS push can be tracked and
     retried. When Loyalty lapses the pager turns off through the bridge (data kept on the POS side), and
     comes back on by itself when Loyalty is paid again.
   - STANDALONE for a business without paid Loyalty: Basic / Plus per branch, 14-day trial, checkout
     through mirqam-billing (platform "loyalty", sub-account `pager:<tenant>`, `<plan>_branch` add-ons).

   A paid standalone subscription on a workspace that has (or later buys) paid Loyalty is never charged
   again: its renewal is stopped once (included_since), the pager stays on as included, nothing is
   refunded automatically, and the case is logged and listed in HQ admin for Mirqam to settle by hand.

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
  pagerPrice,
} from '@mirqam-points/shared'
import { HttpError } from './http.js'
import { posManagedEntitlement } from './pos-bridge/native.mjs'

const DAY = 86_400_000
const LIVE = new Set(['trialing', 'active', 'past_due'])
const PREFIX = 'pager'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ref = (tenantId) => `${PREFIX}:${tenantId}`
// A Loyalty plan with no end date known here (should not happen): keep the included pager a year ahead.
const FAR = () => new Date(Date.now() + 365 * DAY)

/** `pager_plus_loyalty` → { tier: 'plus', withLoyalty: true }. Null for anything else (old codes still parse). */
export function parsePagerCode(code) {
  const m = /^pager_(basic|plus)(_loyalty)?$/.exec(String(code || ''))
  return m ? { tier: m[1], withLoyalty: Boolean(m[2]) } : null
}

/** What the included pager is, from the constant: tier and branch count (null = every branch). */
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

  /** What the POS should run for this workspace: included (paid Loyalty) wins over the row's own plan. */
  function effective(r, included, now = new Date()) {
    if (included) return { active: true, ...includedPlan(), until: included.until }
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
      else error = res.status === 409 && body.code === 'pos_email_in_use' ? 'pos_email_in_use' : `pos_http_${res.status}`
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

  /**
   * Brings the row in line with the Loyalty plan. With paid Loyalty: no row yet → a 'loyalty' row (only
   * when `create`, i.e. the first visit to the Pager tab); a trial or a lapsed loyalty row → included at
   * once (no gap); a paid pager subscription → renewal stopped once, logged. Without paid Loyalty: a live
   * 'loyalty' row lapses (pager off, data kept). Pushes to the POS when what it should run changed.
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
      if (r.source === 'trial' || r.source === 'loyalty') {
        const changed = r.source !== 'loyalty' || !live(r, now) || new Date(r.expires_at).getTime() !== included.until.getTime() || r.tier !== tier
        if (changed) {
          await db.query(
            "UPDATE pager_subscriptions SET source='loyalty', status='active', tier=$2, branches=$3, expires_at=$4, updated_at=now() WHERE tenant_id=$1",
            [tenantId, tier, branches, included.until],
          )
          if (r.pos_state !== 'on' || r.source !== 'loyalty' || r.pos_error) await pushToPos(tenantId, included)
        }
        return { included }
      }
      // A paid standalone subscription: never charge it again; keep the pager on as included.
      if (r.source === 'billing' && !r.included_since) {
        let stopped = false
        if (live(r, now) && billing.remote && billing.subAccountCancel) {
          try {
            await billing.subAccountCancel(ref(tenantId))
            stopped = true
          } catch (err) {
            log.warn?.(`[pager] could not stop the renewal of ${ref(tenantId)} now that Loyalty includes it: ${err?.code || err?.message}`)
          }
        } else stopped = true
        if (stopped) {
          await db.query('UPDATE pager_subscriptions SET included_since=now(), updated_at=now() WHERE tenant_id=$1', [tenantId])
          log.warn?.(
            `[pager] settle by hand: ${ref(tenantId)} (${r.tier}${r.with_loyalty ? ', with-Loyalty price' : ''}, ${r.cycle ?? 'n/a'}, ${r.branches} branch) is now included with paid Loyalty; renewal stopped, nothing refunded`,
          )
          await pushToPos(tenantId, included)
        }
      }
      return { included }
    }
    // No paid Loyalty: an included pager lapses (turned off on the POS, everything kept there).
    if (r?.source === 'loyalty' && live(r, now)) {
      await db.query("UPDATE pager_subscriptions SET status='expired', expires_at=$2, updated_at=now() WHERE tenant_id=$1", [tenantId, now])
      await pushToPos(tenantId, null)
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
    const extra = (ent.items || []).find((i) => i.code === pagerBranchAddonCode(plan.tier, plan.withLoyalty))
    const branches = Math.min(PAGER_MAX_BRANCHES, 1 + Math.max(0, Number(extra?.quantity) || 0))
    const status = ['trialing', 'active', 'past_due', 'suspended', 'canceled', 'expired'].includes(ent.status) ? ent.status : 'expired'
    const until =
      LIVE.has(status) && ent.active_until ? new Date(ent.active_until) : new Date(Math.min(Date.now(), new Date(ent.active_until || Date.now()).getTime()))
    const changed = await db.tx(async (tx) => {
      await tx.query('SELECT id FROM tenants WHERE id=$1 FOR UPDATE', [tenantId])
      const prior = await row(tenantId, tx)
      if (prior && prior.source === 'billing' && Number(prior.billing_version) > Number(ent.version || 0)) return false
      await tx.query(
        `INSERT INTO pager_subscriptions(tenant_id,tier,cycle,branches,with_loyalty,status,source,expires_at,billing_version,updated_at)
         VALUES($1,$2,$3,$4,$5,$6,'billing',$7,$8,now())
         ON CONFLICT(tenant_id) DO UPDATE SET tier=EXCLUDED.tier, cycle=EXCLUDED.cycle, branches=EXCLUDED.branches,
           with_loyalty=EXCLUDED.with_loyalty, status=EXCLUDED.status, source='billing', expires_at=EXCLUDED.expires_at,
           billing_version=EXCLUDED.billing_version, updated_at=now()`,
        [tenantId, plan.tier, ent.cycle === 'yearly' ? 'yearly' : 'monthly', branches, plan.withLoyalty, status, until, Number(ent.version || 0)],
      )
      return true
    })
    if (changed) {
      await pushToPos(tenantId)
      // Paid Loyalty at the same time: stop this subscription's renewal (once).
      await ensureIncluded(tenantId)
    }
    return changed
  }

  if (billing.remote && billing.onSubAccount) billing.onSubAccount(PREFIX, applyEntitlement)
  // A Loyalty plan changed (paid, renewed, lapsed): the included pager follows it at once.
  if (billing.onLoyaltyApplied) billing.onLoyaltyApplied((tenantId) => ensureIncluded(tenantId).catch(() => {}))

  /** Standalone prices (the only ones sold). */
  function offers() {
    const out = {}
    for (const tier of PAGER_TIERS) {
      out[tier] = {
        monthly: pagerPrice(tier, 'monthly'),
        yearly: pagerPrice(tier, 'yearly'),
        freeWithPosAdvanced: PAGER_PLANS[tier].freeWithPosAdvanced,
      }
    }
    return { prices: out, cycles: PAGER_CYCLES }
  }

  return {
    applyEntitlement,
    pushToPos,
    ensureIncluded,
    paidLoyalty,

    async status(tenantId) {
      const included = await paidLoyalty(tenantId)
      const r = await row(tenantId)
      const base = {
        ...offers(),
        currency: 'SAR',
        vatExcluded: true,
        trialDays: PAGER_TRIAL_DAYS,
        maxBranches: PAGER_MAX_BRANCHES,
        // Included with paid Loyalty: nothing to buy, no trial.
        included: Boolean(included),
        trialAvailable: !included && !r,
        purchasable: !included && Boolean(billing.remote && billing.ready),
        checkoutHost: billing.checkoutHost || null,
        // An included pager whose Loyalty plan lapsed: the page offers both ways back.
        lapsedFromLoyalty: !included && r?.source === 'loyalty' && !live(r),
      }
      if (included) {
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
            // A paid standalone subscription Loyalty took over: still listed until its period ends.
            ...(r?.source === 'billing'
              ? { replacedSubscription: { tier: r.tier, cycle: r.cycle, expiresAt: r.expires_at, renewalStopped: Boolean(r.included_since) } }
              : {}),
          },
        }
      }
      return {
        ...base,
        subscription: r && {
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
        },
      }
    },

    /** Starts the one free trial (no card). Turns the pager on in the POS right away. */
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

    /** Standalone checkout. Never offered or accepted while the pager is included with paid Loyalty, and
        only the standalone codes are ever sold (the pager_*_loyalty codes stay in the catalog for old invoices). */
    async checkout(tenantId, { tier, cycle, branches, coupon, autoRenew }, requestKey, returnBase) {
      const n = Number(branches ?? 1)
      if (!PAGER_TIERS.includes(tier) || !PAGER_CYCLES.includes(cycle) || !Number.isInteger(n) || n < 1 || n > PAGER_MAX_BRANCHES)
        throw new HttpError(400, 'validation_failed')
      if (await paidLoyalty(tenantId)) throw new HttpError(409, 'pager_included')
      if (!billing.remote || !billing.subAccountCheckout) throw new HttpError(503, 'billing_unavailable')
      const r = await billing.subAccountCheckout(
        tenantId,
        ref(tenantId),
        {
          plan: pagerBillingCode(tier),
          cycle,
          items: n > 1 ? [{ plan: pagerBranchAddonCode(tier), quantity: n - 1 }] : [],
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

    /** HQ admin: paid pager subscriptions Loyalty took over (renewal stopped, nothing refunded): settle by hand. */
    async toSettle() {
      return (
        await db.query(
          `SELECT p.tenant_id, t.name, p.tier, p.cycle, p.branches, p.with_loyalty, p.status, p.expires_at, p.included_since
             FROM pager_subscriptions p JOIN tenants t ON t.id = p.tenant_id
            WHERE p.source = 'billing' AND p.included_since IS NOT NULL
            ORDER BY p.included_since DESC LIMIT 200`,
        )
      ).rows
    },

    /* Lifecycle job: ends lapsed trials, follows the Loyalty plan (included, lapse, comeback, stopped renewals),
       and retries POS pushes that failed or are out of date. */
    async runLifecycle(now = new Date()) {
      await db.query("UPDATE pager_subscriptions SET status='expired', updated_at=now() WHERE source='trial' AND status='trialing' AND expires_at <= $1", [now])
      const due = (
        await db.query(
          `SELECT tenant_id FROM pager_subscriptions
            WHERE source = 'loyalty'
               OR (source = 'trial' AND status = 'trialing')
               OR (source = 'billing' AND included_since IS NULL AND status IN ('trialing','active','past_due'))
               OR pos_error IS NOT NULL
               OR pos_state IS NULL
               OR (pos_state = 'on') <> (status IN ('trialing','active','past_due') AND expires_at > $1)
               OR (source = 'billing' AND (updated_at < $2 OR expires_at < $3))
            ORDER BY updated_at LIMIT 200`,
          [now, new Date(now.getTime() - 6 * 3_600_000), new Date(now.getTime() + DAY)],
        )
      ).rows
      let pushed = 0
      for (const { tenant_id } of due) {
        const r0 = await row(tenant_id)
        if (r0?.source === 'billing') await this.sync(tenant_id).catch(() => {})
        const { included } = await ensureIncluded(tenant_id, { now })
        const r = await row(tenant_id)
        const want = effective(r, included, now)
        const stale = r && (r.pos_error || !r.pos_state || (r.pos_state === 'on') !== want.active)
        if (stale && (await pushToPos(tenant_id, included))?.ok) pushed += 1
      }
      return { pagerPushed: pushed }
    },
  }
}
