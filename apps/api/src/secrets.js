/* Small crypto helpers: random codes, hashing and AES-256-GCM sealing. */
import crypto from 'node:crypto'

// Crockford base32: no I, L, O, U — unambiguous when read aloud or typed.
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

export function randomCode(length) {
  const bytes = crypto.randomBytes(length)
  let out = ''
  for (const b of bytes) out += ALPHABET[b & 31]
  return out
}

/** Canonical form of a typed/scanned code: uppercase, no separators, Crockford look-alikes folded. */
export function normalizeCode(input) {
  return String(input ?? '')
    .toUpperCase()
    .replace(/[\s-]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1')
}

export const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex')

export const randomToken = (bytes = 24) => crypto.randomBytes(bytes).toString('base64url')

export function safeEqual(a, b) {
  const x = Buffer.from(String(a))
  const y = Buffer.from(String(b))
  return x.length === y.length && crypto.timingSafeEqual(x, y)
}

function keyFrom(secret) {
  if (!secret) throw Object.assign(new Error('SECRET_KEY is not configured'), { code: 'secret_key_missing' })
  return crypto.createHash('sha256').update(secret).digest()
}

/** AES-256-GCM. Output: base64url(iv | tag | ciphertext). */
export function seal(plaintext, secret) {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', keyFrom(secret), iv)
  const body = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()])
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64url')
}

export function unseal(sealed, secret) {
  const raw = Buffer.from(sealed, 'base64url')
  const decipher = crypto.createDecipheriv('aes-256-gcm', keyFrom(secret), raw.subarray(0, 12))
  decipher.setAuthTag(raw.subarray(12, 28))
  return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8')
}
