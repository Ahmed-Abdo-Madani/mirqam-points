/* How this process runs. One image serves four roles during the Frankfurt move
   (RUNBOOK.md, "Move to Frankfurt"):

     forward    FORWARD_TO=https://mirqam-points-fra.onrender.com
                Proxies every request to that origin (forwarder.js). Never opens
                the database and runs no background job. The old Oregon service
                ends here, so installed apps that hardcode its onrender.com
                address keep working.
     standby    MIRQAM_REQUIRE_LIVE=1 without MIRQAM_LIVE=1 (or MIRQAM_STANDBY=1)
                Health checks only (standby.js). A NEW service is declared with
                MIRQAM_REQUIRE_LIVE=1, so an unset variable can never make it
                write to a database that has not been copied yet.
     read-only  MIRQAM_READ_ONLY=1: the full app, but every write is refused
                with 503 `maintenance` and the database session itself is read
                only; no background job runs. The write freeze of the cutover.
     live       everything else: the app as it always ran.

   FORWARD_TO wins over everything: a forwarder must never touch a database. */

export function runtimeMode(env = process.env) {
  const forwardTo = (env.FORWARD_TO || '').trim()
  if (forwardTo) return { kind: 'forward', upstream: upstreamOrigin(forwardTo) }
  const standby = env.MIRQAM_STANDBY === '1' || (env.MIRQAM_REQUIRE_LIVE === '1' && env.MIRQAM_LIVE !== '1')
  if (standby) return { kind: 'standby' }
  return { kind: 'live', readOnly: env.MIRQAM_READ_ONLY === '1' }
}

/** FORWARD_TO must be a bare origin (https in production); anything else is a configuration error. */
export function upstreamOrigin(value) {
  let url
  try {
    url = new URL(value)
  } catch {
    throw new Error('FORWARD_TO must be an absolute URL such as https://mirqam-points-fra.onrender.com')
  }
  if (!/^https?:$/.test(url.protocol) || url.username || url.password || url.search || url.hash || (url.pathname && url.pathname !== '/')) {
    throw new Error('FORWARD_TO must be a bare origin such as https://mirqam-points-fra.onrender.com (no path, query or credentials)')
  }
  return url.origin
}
