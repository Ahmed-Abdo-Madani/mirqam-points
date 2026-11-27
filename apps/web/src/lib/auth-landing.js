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
   authLanding's own checks are stored or followed. */
const KEY = 'mirqam-auth-landing'

export function rememberLanding(landing, storage = globalThis.sessionStorage) {
  try {
    if (landing !== '/app' && (safeNext(landing) || landing === PAGER_LANDING)) storage?.setItem(KEY, landing)
    else storage?.removeItem(KEY)
  } catch {}
}

export function takeLanding(storage = globalThis.sessionStorage) {
  try {
    const value = storage?.getItem(KEY)
    storage?.removeItem(KEY)
    return value && (safeNext(value) || value === PAGER_LANDING) ? value : null
  } catch {
    return null
  }
}
