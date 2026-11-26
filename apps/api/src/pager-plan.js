/* Mirqam Pager plan (بيجر مرقام), sold on the loyalty platform as its own product.

   - Prices: packages/shared/src/pager-plans.js (per branch, excl. VAT). Owners with a
     paid Mirqam Loyalty subscription get the "with Loyalty" prices.
   - Billing: mirqam-billing, platform "loyalty", sub-account `pager:<tenant>` (one
     subscription per billing account, so the pager never touches the loyalty
     subscription). Extra branches are the `<plan>_branch` add-on × (branches - 1).
   - Trial: 14 days, once per workspace, no card.
   - Entitlement → POS: every change pushes `active` to the POS API
     (POST /v1/loyalty-bridge/pager), which switches the tenant's `pager` product on
     (creating a pager-only POS tenant for a loyalty-only business). A failed push is
     retried by the lifecycle job (`sync`). */
import {
  PAGER_CYCLES,
  PAGER_MAX_BRANCHES,
  PAGER_PLANS,
  PAGER_TIERS,
  PAGER_TRIAL_DAYS,
  pagerBillingCode,
  pagerBranchAddonCode,
  pagerPrice,
} from '@mirqam-points/shared'
import { HttpError } from './http.js'

const DAY = 86_400_000
const LIVE = new Set(['trialing', 'active', 'past_due'])
const PREFIX = 'pager'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ref = (tenantId) => `${PREFIX}:${tenantId}`

/** `pager_plus_loyalty` → { tier: 'plus', withLoyalty: true }. Null for anything else. */
export function parsePagerCode(code) {
  const m = /^pager_(basic|plus)(_loyalty)?$/.exec(String(code || ''))
  return m ? { tier: m[1], withLoyalty: Boolean(m[2]) } : null
}

export function createPagerPlan({ db, config, billing, fetcher = fetch }) {
  const bridgeReady = () => (config.posBridgeKey || '').length >= 32 && /^(https:\/\/|http:\/\/(localhost|127\.0\.0\.1)[:/])/.test(config.posApiUrl || '')

  /** Paid Mirqam Loyalty (not a trial) unlocks the bundle prices. POS-managed workspaces count as paid. */
  async function hasPaidLoyalty(tenantId) {
    const s = await billing.state(tenantId)
    return s.state === 'active' || s.state === 'expiring'
  }

  async function row(tenantId, q = db) {
    return (await q.query('SELECT * FROM pager_subscriptions WHERE tenant_id=$1', [tenantId])).rows[0] || null
  }

  const live = (r, now = new Date()) => Boolean(r && LIVE.has(r.status) && new Date(r.expires_at) > now)

  /* Pushes the current state to the POS API. Never throws: the error is kept on the row and retried. */
  async function pushToPos(tenantId) {
    const r = await row(tenantId)
    if (!r) return null
    const active = live(r)
    const want = active ? 'on' : 'off'
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
          active,
          plan: r.tier,
          branches: r.branches,
          until: active ? new Date(r.expires_at).toISOString() : null,
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
      [tenantId, posTenant, error, want],
    )
    return { ok: !error, reason: error }
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
    if (changed) await pushToPos(tenantId)
    return changed
  }

  if (billing.remote && billing.onSubAccount) billing.onSubAccount(PREFIX, applyEntitlement)

  async function offers(tenantId) {
    const withLoyalty = await hasPaidLoyalty(tenantId)
    const out = {}
    for (const tier of PAGER_TIERS) {
      out[tier] = {
        monthly: pagerPrice(tier, 'monthly', withLoyalty),
        yearly: pagerPrice(tier, 'yearly', withLoyalty),
        listMonthly: PAGER_PLANS[tier].prices.monthly,
        listYearly: PAGER_PLANS[tier].prices.yearly,
        freeWithPosAdvanced: PAGER_PLANS[tier].freeWithPosAdvanced,
      }
    }
    return { withLoyalty, prices: out }
  }

  return {
    applyEntitlement,
    pushToPos,

    async status(tenantId) {
      const r = await row(tenantId)
      const o = await offers(tenantId)
      return {
        ...o,
        currency: 'SAR',
        vatExcluded: true,
        trialDays: PAGER_TRIAL_DAYS,
        maxBranches: PAGER_MAX_BRANCHES,
        trialAvailable: !r,
        purchasable: Boolean(billing.remote && billing.ready),
        checkoutHost: billing.checkoutHost || null,
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
      const inserted = (
        await db.query(
          `INSERT INTO pager_subscriptions(tenant_id,tier,branches,status,source,expires_at,trial_started_at)
           VALUES($1,$2,1,'trialing','trial',now() + make_interval(days => $3),now())
           ON CONFLICT (tenant_id) DO NOTHING RETURNING tenant_id`,
          [tenantId, tier, PAGER_TRIAL_DAYS],
        )
      ).rows[0]
      if (!inserted) throw new HttpError(409, 'pager_trial_used')
      await pushToPos(tenantId)
      return this.status(tenantId)
    },

    async checkout(tenantId, { tier, cycle, branches, autoRenew }, requestKey, returnBase) {
      const n = Number(branches ?? 1)
      if (!PAGER_TIERS.includes(tier) || !PAGER_CYCLES.includes(cycle) || !Number.isInteger(n) || n < 1 || n > PAGER_MAX_BRANCHES)
        throw new HttpError(400, 'validation_failed')
      if (!billing.remote || !billing.subAccountCheckout) throw new HttpError(503, 'billing_unavailable')
      const withLoyalty = await hasPaidLoyalty(tenantId)
      const r = await billing.subAccountCheckout(
        tenantId,
        ref(tenantId),
        {
          plan: pagerBillingCode(tier, withLoyalty),
          cycle,
          items: n > 1 ? [{ plan: pagerBranchAddonCode(tier, withLoyalty), quantity: n - 1 }] : [],
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

    /* Lifecycle job: ends lapsed trials and retries POS pushes that failed or are out of date. */
    async runLifecycle(now = new Date()) {
      await db.query("UPDATE pager_subscriptions SET status='expired', updated_at=now() WHERE source='trial' AND status='trialing' AND expires_at <= $1", [now])
      const due = (
        await db.query(
          `SELECT tenant_id FROM pager_subscriptions
            WHERE pos_error IS NOT NULL
               OR pos_state IS NULL
               OR (pos_state = 'on') <> (status IN ('trialing','active','past_due') AND expires_at > $1)
               OR (source = 'billing' AND (updated_at < $2 OR expires_at < $3))
            ORDER BY updated_at LIMIT 100`,
          [now, new Date(now.getTime() - 6 * 3_600_000), new Date(now.getTime() + DAY)],
        )
      ).rows
      let pushed = 0
      for (const { tenant_id } of due) {
        if ((await row(tenant_id))?.source === 'billing') await this.sync(tenant_id).catch(() => {})
        const r = await row(tenant_id)
        const stale = r && (r.pos_error || !r.pos_state || (r.pos_state === 'on') !== live(r, now))
        if (stale && (await pushToPos(tenant_id))?.ok) pushed += 1
      }
      return { pagerPushed: pushed }
    },
  }
}
