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

/** "Starting" stops after this many failed tries or this long, whichever comes first. */
export const STARTING_MAX_FAILED = 3
export const STARTING_MAX_MS = 60_000
/** Where the page sends a business whose setup did not finish (the support WhatsApp, as the floating button). */
export const SUPPORT_WHATSAPP = 'https://wa.me/966552090433'

/** The "starting" watch after one more answer: counts the failed tries (an answer with posError) from when it began. */
export function nextStartingWatch(watch, data, now = Date.now()) {
  const since = watch?.since ?? now
  const failed = (watch?.failed ?? 0) + (data?.posError ? 1 : 0)
  return { since, failed }
}

/** True once the page should stop waiting: STARTING_MAX_FAILED failed tries, or STARTING_MAX_MS since it began. */
export function startingGaveUp(watch, now = Date.now()) {
  if (!watch) return false
  return watch.failed >= STARTING_MAX_FAILED || now - watch.since >= STARTING_MAX_MS
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
