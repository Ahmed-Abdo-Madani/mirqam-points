/* Pure logic of the /app/pager page (kept apart for tests). */

/** Which screen to show: loading, no_plan (offer the trial), starting (plan live, POS being set up),
    live (the counter) or unavailable (POS unreachable: a plain message and a retry). */
export function pagerPageState({ data, error, loading }) {
  if (error) return error.code === 'pager_no_plan' ? 'no_plan' : 'unavailable'
  if (loading && !data) return 'loading'
  if (!data) return 'unavailable'
  if (data.status === 'no_plan' || data.status === 'starting' || data.status === 'live') return data.status
  return 'unavailable'
}

/** The counter's columns: waiting first (oldest first), then ready (most recent call first), then today's done. */
export function counterColumns(tickets = []) {
  const waiting = tickets.filter((t) => t.status === 'WAITING').sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  const ready = tickets.filter((t) => t.status === 'READY').sort((a, b) => (b.readyAt || '').localeCompare(a.readyAt || ''))
  const done = tickets.filter((t) => t.status !== 'WAITING' && t.status !== 'READY')
  return { waiting, ready, done }
}

/** The branch the counter shows: the one picked before if it still exists and is in the plan, else the first in the plan. */
export function pickBranch(branches = [], saved) {
  const usable = branches.filter((b) => b.active !== false && b.inPlan !== false)
  return (usable.find((b) => b.id === saved) ?? usable[0] ?? null)?.id ?? null
}

/** Branches and the customer-page brand can be changed here only for a business the pager plan made; a
    real POS business manages them in Mirqam POS (the POS answers 403 managed_in_pos). */
export const canEditBusiness = (state) => state?.managedInPos !== true

/** The phone tabs: Home, the centre button, Settings, and the pager where it fits.
    - pager live, no active loyalty programme → the centre button is the pager (3 tabs);
    - pager live and a programme → Home, Scan, Pager, Settings (4 tabs, one tap each);
    - no pager → as before (Home, Scan, Settings). */
export function phoneTabs({ pagerLive, hasProgram, canTransact }) {
  if (!canTransact) return ['home', 'settings']
  if (pagerLive && !hasProgram) return ['home', 'pager', 'settings']
  if (pagerLive) return ['home', 'scan', 'pager', 'settings']
  return ['home', 'scan', 'settings']
}

const DONE = new Set(['COLLECTED', 'CLOSED', 'CANCELLED', 'EXPIRED'])

/** The three live figures on the counter's top row: preparing, ready, and today's average wait
    (from the number being made to it being ready), in whole minutes, or null when nothing was ready yet. */
export function counterFigures(tickets = []) {
  const waits = tickets
    .filter((t) => t.readyAt && t.createdAt)
    .map((t) => (Date.parse(t.readyAt) - Date.parse(t.createdAt)) / 60000)
    .filter((m) => Number.isFinite(m) && m >= 0)
  return {
    preparing: tickets.filter((t) => t.status === 'WAITING').length,
    ready: tickets.filter((t) => t.status === 'READY').length,
    avgWaitMinutes: waits.length ? Math.round(waits.reduce((a, b) => a + b, 0) / waits.length) : null,
  }
}

/** The last numbers closed today, newest first (the side rail shows five). */
export function lastClosed(tickets = [], n = 5) {
  const at = (t) => t.collectedAt || t.closedAt || t.updatedAt || t.readyAt || t.createdAt || ''
  return tickets
    .filter((t) => DONE.has(t.status))
    .sort((a, b) => at(b).localeCompare(at(a)))
    .slice(0, n)
}

/** The amount typed at the counter (e.g. "25.5") in halalas, or undefined when empty; NaN when invalid. */
export function amountMinor(text) {
  const s = String(text ?? '')
    .trim()
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace('٫', '.')
  if (!s) return undefined
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(s)) return Number.NaN
  return Math.round(Number(s) * 100)
}

/** A Riyadh calendar day (YYYY-MM-DD): the POS counts pager reports in Riyadh days. */
export const riyadhDay = (at = new Date()) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(at)
