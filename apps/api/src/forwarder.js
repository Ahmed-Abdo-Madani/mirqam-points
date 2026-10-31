/* Forwarder mode (FORWARD_TO): the old Oregon service proxies every request to
   the Frankfurt service, so the installed Points Business apps — which
   hardcode https://mirqam-points.onrender.com for their API and for native
   live-update checks — keep working after the move, and so does
   loyalty.mirqam.sa until its DNS points at Frankfurt.

   - Bodies stream both ways (uploads, wallet passes, live-update zips,
     event streams); nothing is buffered or parsed.
   - Host becomes the upstream's (Render routes by Host); the original host,
     protocol and client address travel in X-Forwarded-* AND in a signed
     `x-mirqam-forwarded` header. The upstream trusts the signed copy only
     (the key derives from SECRET_KEY, which both services share because the
     gift-card codes are sealed with it), restores the original Host and
     client IP, and so keeps per-client rate limits, same-origin checks,
     hq-entry's host check and billing return URLs exactly as before.
   - Redirects to the upstream's own origin are rewritten back to the host
     the client used.
   No database, no background job: the Oregon database stays untouched (and
   is the rollback). */
import { createHmac, timingSafeEqual } from 'node:crypto'
import http from 'node:http'
import https from 'node:https'

export const FORWARD_HEADER = 'x-mirqam-forwarded'
const MAX_SKEW_MS = 5 * 60_000

// RFC 9110 §7.6.1 connection-specific headers, plus the ones we set ourselves.
const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'proxy-connection',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  // This process already answered any 100-continue itself.
  'expect',
])

const forwardKey = (secretKey) => createHmac('sha256', secretKey).update('mirqam-points/forwarder/v1').digest()
const b64 = (s) => Buffer.from(String(s), 'utf8').toString('base64url')
const unb64 = (s) => Buffer.from(String(s), 'base64url').toString('utf8')
const mac = (key, parts) => createHmac('sha256', key).update(parts.join('\n')).digest('base64url')

/** Signed statement "this request came from the forwarder, for this client, host and protocol".
    Not bound to the path: Render's edge may normalise URLs, which must not break verification. */
export function signForwarded(secretKey, { ip, host, proto, now = Date.now() }) {
  const ts = String(now)
  const sig = mac(forwardKey(secretKey), [ts, ip, host, proto])
  return [ts, b64(ip), b64(host), proto, sig].join('.')
}

/** The verified statement, or null (missing key, malformed, stale, or forged). */
export function verifyForwarded(secretKey, header, { now = Date.now() } = {}) {
  if (!secretKey || typeof header !== 'string' || header.length > 1024) return null
  const parts = header.split('.')
  if (parts.length !== 5) return null
  const [ts, ipB64, hostB64, proto, sig] = parts
  if (!/^\d{1,15}$/.test(ts) || Math.abs(now - Number(ts)) > MAX_SKEW_MS) return null
  if (proto !== 'https' && proto !== 'http') return null
  const ip = unb64(ipB64)
  const host = unb64(hostB64)
  if (!/^[0-9a-fA-F:.]{2,64}$/.test(ip) || !/^[a-zA-Z0-9.-]{1,253}(:\d{1,5})?$/.test(host)) return null
  const expected = Buffer.from(mac(forwardKey(secretKey), [ts, ip, host, proto]))
  const given = Buffer.from(sig)
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null
  return { ip, host, proto }
}

/* Upstream side (app.js, first middleware): a verified forwarded request is
   handled as if it had arrived directly. An unverifiable header is dropped
   and the request is handled as an ordinary direct request. */
export function acceptForwarded(config) {
  return (req, _res, next) => {
    const header = req.headers[FORWARD_HEADER]
    if (header === undefined) return next()
    delete req.headers[FORWARD_HEADER]
    const fwd = verifyForwarded(config.secretKey, header)
    if (fwd) {
      req.headers.host = fwd.host
      for (const [name, value] of [
        ['ip', fwd.ip],
        ['protocol', fwd.proto],
      ])
        Object.defineProperty(req, name, { value, configurable: true, enumerable: true, writable: true })
      req.forwarded = true
    }
    next()
  }
}

/** Client address as Express computes it with `trust proxy` = hops (a number). */
export function clientIp(req, hops) {
  const chain = String(req.headers['x-forwarded-for'] || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  const addrs = [req.socket.remoteAddress || '', ...chain.reverse()]
  return addrs[Math.min(Math.max(hops, 0), addrs.length - 1)].replace(/^::ffff:/, '')
}

/** Forwarder side: an http.Server that proxies everything to `upstream` (an origin). */
export function createForwarder({ upstream, secretKey = '', trustProxy = 1, log = console }) {
  const target = new URL(upstream)
  const transport = target.protocol === 'https:' ? https : http
  const agent = new transport.Agent({ keepAlive: true, maxSockets: 256 })

  const server = http.createServer((req, res) => {
    if (req.url === '/__forwarder/health') {
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' })
      return res.end(JSON.stringify({ ok: true, forwarding: target.origin }))
    }
    const host = String(req.headers.host || target.host)
    const proto = trustProxy > 0 && /^https/i.test(String(req.headers['x-forwarded-proto'] || '')) ? 'https' : req.socket.encrypted ? 'https' : 'http'
    const ip = clientIp(req, trustProxy)

    const headers = {}
    for (const [name, value] of Object.entries(req.headers)) {
      if (!HOP_BY_HOP.has(name) && name !== 'host' && name !== FORWARD_HEADER) headers[name] = value
    }
    headers.host = target.host
    headers['x-forwarded-host'] = host
    headers['x-forwarded-proto'] = proto
    if (!headers['x-forwarded-for']) headers['x-forwarded-for'] = ip
    if (secretKey) headers[FORWARD_HEADER] = signForwarded(secretKey, { ip, host, proto })

    const upstreamReq = transport.request(
      { protocol: target.protocol, hostname: target.hostname, port: target.port || undefined, method: req.method, path: req.url, headers, agent },
      (upstreamRes) => {
        const out = {}
        for (const [name, value] of Object.entries(upstreamRes.headers)) if (!HOP_BY_HOP.has(name)) out[name] = value
        if (typeof out.location === 'string' && out.location.startsWith(target.origin)) {
          out.location = `${proto}://${host}${out.location.slice(target.origin.length)}`
        }
        out['x-mirqam-forwarder'] = '1'
        res.writeHead(upstreamRes.statusCode || 502, upstreamRes.statusMessage, out)
        // Event streams and long downloads: flush as bytes arrive.
        upstreamRes.pipe(res)
        upstreamRes.on('error', () => res.destroy())
      },
    )
    upstreamReq.on('error', (err) => {
      log.warn?.(`[forward] ${req.method} ${req.url.split('?')[0]} failed: ${err.code || err.message}`)
      if (res.headersSent) return res.destroy()
      res.writeHead(502, { 'content-type': 'application/json', 'cache-control': 'no-store', 'retry-after': '30' })
      res.end(JSON.stringify({ error: 'http_error' }))
    })
    // A client that goes away cancels the upstream request too.
    res.on('close', () => {
      if (!res.writableFinished) upstreamReq.destroy()
    })
    req.pipe(upstreamReq)
  })
  // Longer than Render's load-balancer idle timeout, so kept-alive sockets are never cut mid-request.
  server.keepAliveTimeout = 65_000
  server.headersTimeout = 66_000
  server.requestTimeout = 0
  server.on('close', () => agent.destroy())
  return server
}
