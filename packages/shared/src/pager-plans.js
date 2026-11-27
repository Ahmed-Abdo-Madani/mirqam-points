/* Mirqam Pager (بيجر مرقام) — standalone plan catalog. The single place prices live:
   the pricing cards, the API's offers and the billing seed all read these numbers.
   Prices are per branch, in halalas, EXCLUDING VAT (the page says so). The unified
   billing service stores VAT-inclusive amounts, so `billingAmountMinor` adds it.

   Owner-approved 2026-11-26, changed 2026-11-28 ("Basic included and Plus as a paid"):
   - Standalone (a business without a paid Mirqam Loyalty plan): Basic 29/month or 290/year,
     Plus 49/month or 490/year per branch; 14-day free trial, no card.
   - With a paid Mirqam Loyalty plan, Basic is INCLUDED (no pager subscription, no checkout): see
     PAGER_INCLUDED_WITH_LOYALTY. Plus is a paid upgrade at the with-Loyalty Plus price, 25/month or
     250/year per branch (pager_plus_loyalty + its _branch add-on). The Basic with-Loyalty price (15/150)
     is no longer sold.
   - Basic is included free with Mirqam POS ADVANCED. */

export const PAGER_VAT_RATE = 0.15
export const PAGER_TRIAL_DAYS = 14
export const PAGER_MAX_BRANCHES = 50
export const PAGER_TIERS = ['basic', 'plus']
export const PAGER_CYCLES = ['monthly', 'yearly']

/* Not set by the owner yet (asked twice). Until he answers, the product neither states nor charges them;
   his answer is a one-line change here. */
/** WhatsApp «جاهز» messages per branch per month on Plus. null = no limit stated (and none enforced). */
export const PAGER_WHATSAPP_FAIR_USE = null
/**
 * What a workspace with a paid Mirqam Loyalty plan gets, included, with no pager subscription: the tier,
 * on every branch (up to PAGER_MAX_BRANCHES), as Basic is with POS ADVANCED. One line here; the tests
 * read this constant. The tiers above it are sold to those workspaces at the with-Loyalty price.
 */
export const PAGER_INCLUDED_WITH_LOYALTY = Object.freeze({ tier: 'basic' })

/** Tiers a paid-Loyalty workspace may buy on top of what is included, at the with-Loyalty price (Plus). */
export const pagerLoyaltyUpgrades = () => PAGER_TIERS.slice(PAGER_TIERS.indexOf(PAGER_INCLUDED_WITH_LOYALTY.tier) + 1)

export const PAGER_PLANS = Object.freeze({
  basic: Object.freeze({
    tier: 'basic',
    prices: Object.freeze({ monthly: 2900, yearly: 29000 }),
    // Legacy, not sold since 2026-11-28 (Basic is included with paid Loyalty): kept only so the billing
    // catalog's pager_basic_loyalty codes and old invoices still resolve.
    withLoyalty: Object.freeze({ monthly: 1500, yearly: 15000 }),
    freeWithPosAdvanced: true,
    features: Object.freeze(['unlimitedCalls', 'webAlerts', 'inLoyalty', 'qr', 'tv', 'basicReports', 'branding']),
  }),
  plus: Object.freeze({
    tier: 'plus',
    prices: Object.freeze({ monthly: 4900, yearly: 49000 }),
    // Sold to paid-Loyalty workspaces as the upgrade over the included Basic.
    withLoyalty: Object.freeze({ monthly: 2500, yearly: 25000 }),
    freeWithPosAdvanced: false,
    // WhatsApp «جاهز» messages per branch per month; null = no number shown (PAGER_WHATSAPP_FAIR_USE).
    whatsappFairUse: PAGER_WHATSAPP_FAIR_USE,
    features: Object.freeze(['everythingInBasic', 'whatsappReady', 'liveActivity', 'fullReports', 'multiBranch']),
    // Listed but not shipped yet: the card marks them "coming soon" so nothing is sold before it exists.
    // liveActivity ships with the iPhone App Clip (planned early December 2026).
    comingSoon: Object.freeze(['liveActivity']),
  }),
})

/** The copy key of a plan feature: the WhatsApp line names a monthly limit only when one is set. */
export function pagerFeatureKey(plan, feature) {
  return feature === 'whatsappReady' && !(Number(plan?.whatsappFairUse) > 0) ? 'whatsappReadyNoLimit' : feature
}

/** Billing product codes (platform "loyalty"): the plan covers one branch, the add-on each extra branch. */
export function pagerBillingCode(tier, withLoyalty = false) {
  if (!PAGER_TIERS.includes(tier)) throw new Error(`unknown pager tier: ${tier}`)
  return `pager_${tier}${withLoyalty ? '_loyalty' : ''}`
}
export const pagerBranchAddonCode = (tier, withLoyalty = false) => `${pagerBillingCode(tier, withLoyalty)}_branch`

/** The per-branch price (halalas, excl. VAT) for a tier, cycle and the Loyalty discount. */
export function pagerPrice(tier, cycle, withLoyalty = false) {
  const plan = PAGER_PLANS[tier]
  if (!plan || !PAGER_CYCLES.includes(cycle)) throw new Error('unknown pager plan')
  return (withLoyalty ? plan.withLoyalty : plan.prices)[cycle]
}

/** VAT-inclusive amount the billing service stores for a VAT-exclusive price. Integer halalas. */
export const billingAmountMinor = (exclMinor) => Math.round(exclMinor * (1 + PAGER_VAT_RATE))

/** Total for `branches` branches (excl. VAT). */
export function pagerTotal(tier, cycle, branches, withLoyalty = false) {
  const n = Number(branches)
  if (!Number.isInteger(n) || n < 1 || n > PAGER_MAX_BRANCHES) throw new Error('invalid branches')
  return pagerPrice(tier, cycle, withLoyalty) * n
}

/** The billing-seed products for every pager price (VAT-inclusive amounts, as billing stores them). */
export function pagerBillingProducts() {
  const out = []
  for (const tier of PAGER_TIERS) {
    for (const withLoyalty of [false, true]) {
      const p = PAGER_PLANS[tier]
      const prices = withLoyalty ? p.withLoyalty : p.prices
      const amounts = { monthly: billingAmountMinor(prices.monthly), yearly: billingAmountMinor(prices.yearly) }
      out.push({ code: pagerBillingCode(tier, withLoyalty), kind: 'plan', tier, withLoyalty, prices: amounts })
      out.push({ code: pagerBranchAddonCode(tier, withLoyalty), kind: 'addon', tier, withLoyalty, prices: amounts })
    }
  }
  return out
}
