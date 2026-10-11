/* Staff authentication.
   - Passwords: scrypt with a per-user salt (node:crypto, no native deps).
   - Sessions: opaque random token in an HttpOnly, SameSite=Lax cookie; only
     its SHA-256 is stored, so a database leak does not yield live sessions.
   - CSRF: state-changing requests must be JSON and, when the browser sends an
     Origin, it must be an allowed origin (see app.js).
   Interim until a Mirqam-wide identity provider exists (PLAN.md §5); keep the
   surface of this module small so swapping it stays a one-file change. */
import crypto from 'node:crypto'
import { promisify } from 'node:util'
import { HttpError } from './http.js'

const scrypt = promisify(crypto.scrypt)
const KEYLEN = 64
export const SESSION_COOKIE = 'mp_session'
export const ROLES = ['owner', 'manager', 'cashier', 'analyst']

export async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('base64url')
  const hash = await scrypt(password, salt, KEYLEN)
  return `scrypt$${salt}$${hash.toString('base64url')}`
}

export async function verifyPassword(password, stored) {
  const [scheme, salt, expected] = String(stored).split('$')
  if (scheme !== 'scrypt' || !salt || !expected) return false
  const actual = await scrypt(password, salt, KEYLEN)
  const want = Buffer.from(expected, 'base64url')
  return want.length === actual.length && crypto.timingSafeEqual(want, actual)
}

// A fixed hash used to equalize timing when the email does not exist.
let dummyHash
export async function dummyVerify(password) {
  dummyHash ??= await hashPassword('timing-equalizer')
  await verifyPassword(password, dummyHash)
}

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex')

export async function createSession(db, { userId, tenantId, userAgent, ttlDays }) {
  const token = crypto.randomBytes(32).toString('base64url')
  await db.query(
    `INSERT INTO sessions (token_hash, user_id, tenant_id, user_agent, expires_at)
     VALUES ($1, $2, $3, $4, now() + make_interval(days => $5))`,
    [sha256(token), userId, tenantId, String(userAgent || '').slice(0, 300), ttlDays],
  )
  return token
}

export async function destroySession(db, token) {
  if (token) await db.query('DELETE FROM sessions WHERE token_hash = $1', [sha256(token)])
}

export function readCookie(req, name) {
  const header = req.headers.cookie
  if (!header) return null
  for (const part of header.split(';')) {
    const i = part.indexOf('=')
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim())
  }
  return null
}

export function sessionCookie(token, { production, ttlDays }) {
  const attrs = [`${SESSION_COOKIE}=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${ttlDays * 86400}`]
  if (production) attrs.push('Secure')
  return attrs.join('; ')
}

export function clearedCookie({ production }) {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${production ? '; Secure' : ''}`
}

/** Bearer token from the native app (no cookies in Capacitor webviews across origins). */
export function bearerToken(req) {
  const m = /^Bearer ([A-Za-z0-9_-]{20,100})$/.exec(req.get('authorization') || '')
  return m ? m[1] : null
}

/** Attaches req.auth = { userId, tenantId, role, user, tenant, via } when the cookie or bearer token maps to a live session. */
export function loadSession(db) {
  return async (req, _res, next) => {
    const cookie = readCookie(req, SESSION_COOKIE)
    const bearer = cookie ? null : bearerToken(req)
    const token = cookie || bearer
    if (!token) return next()
    const { rows } = await db.query(
      `SELECT s.user_id, s.tenant_id, s.last_seen_at, m.role,
              u.email, u.name AS user_name, u.locale, t.name AS tenant_name, t.slug, t.logo_version
         FROM sessions s
         JOIN users u ON u.id = s.user_id
         JOIN tenants t ON t.id = s.tenant_id
         JOIN memberships m ON m.user_id = s.user_id AND m.tenant_id = s.tenant_id
        WHERE s.token_hash = $1 AND s.expires_at > now() AND t.closed_at IS NULL`,
      [sha256(token)],
    )
    const row = rows[0]
    if (row) {
      req.auth = {
        token,
        via: cookie ? 'cookie' : 'bearer',
        userId: row.user_id,
        tenantId: row.tenant_id,
        role: row.role,
        user: { id: row.user_id, email: row.email, name: row.user_name, locale: row.locale },
        tenant: {
          id: row.tenant_id,
          name: row.tenant_name,
          slug: row.slug,
          logoUrl: row.logo_version ? `/api/public/logo/${row.slug}?v=${row.logo_version}` : null,
        },
      }
      // Touch at most every 5 minutes to avoid a write per request.
      if (Date.now() - new Date(row.last_seen_at).getTime() > 5 * 60_000) {
        db.query('UPDATE sessions SET last_seen_at = now() WHERE token_hash = $1', [sha256(token)]).catch(() => {})
      }
    }
    next()
  }
}

export function requireAuth(req, _res, next) {
  if (!req.auth) throw new HttpError(401, 'unauthenticated')
  next()
}

/** Role gate. Owners pass every gate. */
export function requireRole(...roles) {
  return (req, _res, next) => {
    if (!req.auth) throw new HttpError(401, 'unauthenticated')
    if (req.auth.role !== 'owner' && !roles.includes(req.auth.role)) throw new HttpError(403, 'forbidden')
    next()
  }
}

export function slugify(name) {
  const ascii = String(name)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
  const suffix = crypto.randomBytes(3).toString('hex')
  return ascii.length >= 2 ? `${ascii}-${suffix}` : `store-${suffix}`
}
