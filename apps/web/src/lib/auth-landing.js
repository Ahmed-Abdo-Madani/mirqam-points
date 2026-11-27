/* Where a visitor lands after signing up or signing in.
 *
 * - A valid `next` (an in-app path under /app, never `//host`) always wins: no open redirect.
 * - `product=pager` (the only product value accepted) is a Mirqam Pager sign-up from mirqam.sa or
 *   pos.mirqam.sa: it lands on the pager page (/app/pager), which offers the trial and then runs the counter.
 * - Anything else: the dashboard, as before.
 */
export const PAGER_LANDING = '/app/pager'

export function safeNext(value) {
  return typeof value === 'string' && value.startsWith('/app') && !value.startsWith('//') ? value : null
}

/** `pager` for `?product=pager`, else null. */
export function authProduct(params) {
  return params.get('product') === 'pager' ? 'pager' : null
}

export function authLanding(params) {
  return safeNext(params.get('next')) ?? (authProduct(params) === 'pager' ? PAGER_LANDING : '/app')
}

/* Social sign-in leaves for Google/GitHub and the server sends it back to /app. The landing is kept in
   this tab's sessionStorage for that round trip and used once (see AppShell). Only values that pass
   authLanding's own checks are stored or followed, and only for this attempt: the sign-in page forgets it
   whenever it opens again (an abandoned social sign-in never decides where a later sign-in lands), and it
   expires after a few minutes. */
const KEY = 'mirqam-auth-landing'
const TTL_MS = 10 * 60_000
const allowed = (to) => typeof to === 'string' && to !== '/app' && Boolean(safeNext(to) || to === PAGER_LANDING)

export function rememberLanding(landing, storage = globalThis.sessionStorage, now = Date.now()) {
  try {
    if (allowed(landing)) storage?.setItem(KEY, JSON.stringify({ to: landing, at: now }))
    else storage?.removeItem(KEY)
  } catch {}
}

export function forgetLanding(storage = globalThis.sessionStorage) {
  try {
    storage?.removeItem(KEY)
  } catch {}
}

export function takeLanding(storage = globalThis.sessionStorage, now = Date.now()) {
  try {
    const raw = storage?.getItem(KEY)
    storage?.removeItem(KEY)
    const saved = raw ? JSON.parse(raw) : null
    return saved && allowed(saved.to) && now - Number(saved.at) >= 0 && now - Number(saved.at) < TTL_MS ? saved.to : null
  } catch {
    return null
  }
}
