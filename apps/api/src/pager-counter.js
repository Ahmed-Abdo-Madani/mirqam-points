/* Mirqam Pager run inside Mirqam Loyalty (website and merchant app): no Cashier app, no pos.mirqam.sa,
   no second account. The POS API stays the pager engine (tickets, the customer page, push, WhatsApp,
   reports); this module reaches it server to server with the bridge key, on behalf of the POS tenant the
   bridge made or linked for this workspace (project_move_over: /v1/loyalty-bridge/pager/:loyaltyTenantId).

   Answers the web page can always render:
   - no live plan        → { status: 'no_plan' } (not an error: the page offers the trial)
   - plan live, POS not linked/on yet (first push still on its way) → { status: 'starting' }
   - POS unreachable / timeout → 503 pager_unavailable (the page shows a plain message and a retry) */
import { DEFAULT_DESIGN } from '@mirqam-points/shared'
import { HttpError } from './http.js'

const TIMEOUT_MS = 8000
const HEX = /^#[0-9a-f]{6}$/i
// What the POS sends back that the page can explain; anything else becomes pager_unavailable.
const PASS_THROUGH = new Set(['pager_branch_limit', 'pager_plus_required', 'branch_not_found', 'invalid_logo_url', 'managed_in_pos', 'validation_failed'])

export function createPagerCounter({ db, config, pager, fetcher = fetch }) {
  const ready = () => (config.posBridgeKey || '').length >= 32 && /^(https:\/\/|http:\/\/(localhost|127\.0\.0\.1)[:/])/.test(config.posApiUrl || '')

  /** One call to the bridge route for this workspace. Throws HttpError with a code the page knows. */
  async function bridge(tenantId, method, path, body) {
    if (!ready()) throw new HttpError(503, 'pager_unavailable')
    let res
    try {
      res = await fetcher(`${config.posApiUrl}/v1/loyalty-bridge/pager/${encodeURIComponent(tenantId)}${path}`, {
        method,
        redirect: 'error',
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { authorization: `Bearer ${config.posBridgeKey}`, 'content-type': 'application/json' },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      })
    } catch {
      throw new HttpError(503, 'pager_unavailable')
    }
    const data = await res.json().catch(() => ({}))
    if (res.ok) return data
    const code = typeof data?.code === 'string' ? data.code : res.status === 400 ? 'validation_failed' : null
    if (code === 'pager_not_linked' || code === 'pager_off') throw new HttpError(409, 'pager_starting')
    if (code && PASS_THROUGH.has(code)) throw new HttpError(res.status >= 500 ? 503 : res.status, code)
    throw new HttpError(503, 'pager_unavailable')
  }

  async function live(tenantId) {
    return Boolean((await pager.status(tenantId)).subscription?.active)
  }

  /** The routes below run only with a live plan; otherwise a clear "start the plan" answer. */
  async function requireLive(tenantId) {
    if (!(await live(tenantId))) throw new HttpError(409, 'pager_no_plan')
  }

  /**
   * The first time, the customer page's brand comes from what the workspace already has in Loyalty: the
   * business name, its logo and its first card's colours. Only while the POS brand is still untouched
   * (default colour, no logo, no Arabic name), so the owner's own changes are never overwritten.
   */
  async function seedBrand(tenantId, state) {
    // A real POS business (managedInPos): its brand is its live store's; never filled from here.
    if (state?.managedInPos) return state
    const b = state?.brand
    if (!b || b.logoUrl || b.nameAr || String(b.primaryColor).toUpperCase() !== '#0F766E') return state
    const t = (await db.query('SELECT name, slug, logo_version FROM tenants WHERE id=$1', [tenantId])).rows[0]
    if (!t) return state
    const design =
      (await db.query("SELECT design FROM programs WHERE tenant_id=$1 AND status <> 'archived' ORDER BY created_at LIMIT 1", [tenantId])).rows[0]?.design || {}
    const patch = { name: t.name }
    const bg = design.background || DEFAULT_DESIGN.background
    const accent = design.label || DEFAULT_DESIGN.label
    if (HEX.test(bg)) patch.primaryColor = bg
    if (HEX.test(accent)) patch.accentColor = accent
    // The POS only takes an https logo (the live site); local development keeps the default.
    if (t.logo_version && /^https:\/\//.test(config.publicUrl || '')) patch.logoUrl = `${config.publicUrl}/api/public/logo/${t.slug}?v=${t.logo_version}`
    try {
      const brand = await bridge(tenantId, 'PUT', '/brand', patch)
      return { ...state, brand }
    } catch {
      return state
    }
  }

  return {
    bridge,
    requireLive,

    /** Everything the /app/pager page needs to choose its state. */
    async overview(tenantId) {
      const plan = await pager.status(tenantId)
      if (!plan.subscription?.active) return { status: 'no_plan', plan }
      try {
        const state = await seedBrand(tenantId, await bridge(tenantId, 'GET', ''))
        // `plan` here is the POS entitlement (tier, Plus features, branches); the loyalty-side subscription is `subscription`.
        return { ...state, status: 'live', subscription: plan.subscription }
      } catch (err) {
        if (err.code === 'pager_starting') return { status: 'starting', plan }
        throw err
      }
    },

    /** For the menu and the phone tabs, without calling the POS: is the pager live, and is there a loyalty programme? */
    async nav(tenantId) {
      const [{ rows: p }, { rows: g }] = await Promise.all([
        db.query("SELECT 1 FROM pager_subscriptions WHERE tenant_id=$1 AND status IN ('trialing','active','past_due') AND expires_at > now()", [tenantId]),
        db.query("SELECT 1 FROM programs WHERE tenant_id=$1 AND status = 'active' LIMIT 1", [tenantId]),
      ])
      return { pagerLive: p.length > 0, hasProgram: g.length > 0 }
    },
  }
}
