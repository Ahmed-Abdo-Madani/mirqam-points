/* Google Wallet REST client (no SDK): service-account OAuth, class/object
   upserts and "Save to Google Wallet" links. Objects are created server-side
   first so the save link is a short "skinny" JWT that only references ids. */
import crypto from 'node:crypto'
import { loyaltyFields, PASS_TEXT } from './model.js'

const API = 'https://walletobjects.googleapis.com/walletobjects/v1'
const b64url = (v) => Buffer.from(typeof v === 'string' ? v : JSON.stringify(v)).toString('base64url')

export function googleConfigured(google) {
  return Boolean(google.issuerId && google.serviceAccount)
}

function signJwt(payload, sa) {
  const head = b64url({ alg: 'RS256', typ: 'JWT' })
  const body = b64url(payload)
  const sig = crypto.createSign('RSA-SHA256').update(`${head}.${body}`).sign(sa.private_key, 'base64url')
  return `${head}.${body}.${sig}`
}

let cachedToken = null
async function accessToken(sa) {
  if (cachedToken && cachedToken.exp > Date.now() + 60_000) return cachedToken.value
  const now = Math.floor(Date.now() / 1000)
  const assertion = signJwt(
    {
      iss: sa.client_email,
      scope: 'https://www.googleapis.com/auth/wallet_object.issuer',
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600,
    },
    sa,
  )
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
  })
  if (!res.ok) throw new Error(`google oauth ${res.status}: ${await res.text()}`)
  const json = await res.json()
  cachedToken = { value: json.access_token, exp: Date.now() + json.expires_in * 1000 }
  return cachedToken.value
}

async function call(google, method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { authorization: `Bearer ${await accessToken(google.serviceAccount)}`, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`google wallet ${method} ${path} → ${res.status}: ${(await res.text()).slice(0, 400)}`)
  return res.json()
}

/* Insert, or PATCH when it already exists (409). */
async function upsert(google, resource, obj) {
  const res = await fetch(`${API}/${resource}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${await accessToken(google.serviceAccount)}`, 'content-type': 'application/json' },
    body: JSON.stringify(obj),
  })
  if (res.status === 409) return call(google, 'PATCH', `/${resource}/${encodeURIComponent(obj.id)}`, obj)
  if (!res.ok) throw new Error(`google wallet insert ${resource} → ${res.status}: ${(await res.text()).slice(0, 400)}`)
  return res.json()
}

const safeId = (s) => s.replace(/[^\w.-]/g, '_')
export const loyaltyClassId = (google, programId) => `${google.issuerId}.${safeId(`prog_${programId}`)}`
export const loyaltyObjectId = (google, model) => `${google.issuerId}.${safeId(`acct_${model.id}_v${model.version}`)}`
export const giftClassId = (google, tenantSlug) => `${google.issuerId}.${safeId(`gift_${tenantSlug}`)}`
export const giftObjectId = (google, model) => `${google.issuerId}.${safeId(`gift_${model.id}`)}`

const BARCODES = { qr: 'QR_CODE', pdf417: 'PDF_417', aztec: 'AZTEC', code128: 'CODE_128' }

/* The merchant's own logo when they uploaded one, otherwise the Mirqam mark. */
const logo = (publicUrl, model) => ({
  sourceUri: { uri: model?.logoUrl || `${publicUrl}/brand/pass-logo.png` },
  contentDescription: { defaultValue: { language: 'ar', value: 'Mirqam' } },
})
const text = (ar, en) => ({ defaultValue: { language: 'ar', value: ar }, translatedValues: [{ language: 'en', value: en }] })

function loyaltyClass(model, google, publicUrl) {
  return {
    id: loyaltyClassId(google, model.programId),
    issuerName: model.merchant,
    programName: model.programName,
    programLogo: logo(publicUrl, model),
    hexBackgroundColor: model.design.background,
    reviewStatus: 'UNDER_REVIEW',
    countryCode: 'SA',
    multipleDevicesAndHoldersAllowedStatus: 'ONE_USER_ALL_DEVICES',
  }
}

function loyaltyObject(model, google, publicUrl) {
  const tx = PASS_TEXT[model.locale === 'en' ? 'en' : 'ar']
  const stamps = model.type === 'stamps' && model.stampsRequired
  const { front, back } = loyaltyFields(model, tx)
  // Google has one account-name slot and one secondary points slot; further fields become text modules.
  const member = front.find((f) => f.key === 'member')
  const secondary = front.find((f) => f.key === 'remaining' || f.key === 'lifetime')
  const extra = front.filter((f) => f !== member && f !== secondary)
  const heroImage =
    model.design.layout === 'strip' && stamps
      ? {
          sourceUri: { uri: `${publicUrl}/api/public/pass/${model.passToken}/strip.png?v=${model.updatedAt.getTime()}` },
          contentDescription: { defaultValue: { language: 'ar', value: model.programName } },
        }
      : undefined
  return {
    id: loyaltyObjectId(google, model),
    classId: loyaltyClassId(google, model.programId),
    state: 'ACTIVE',
    accountId: model.code,
    accountName: member ? member.value : model.memberName || model.code,
    loyaltyPoints: {
      label: model.type === 'stamps' ? tx.stamps : tx.points,
      balance: stamps ? { string: `${model.balance} / ${model.stampsRequired}` } : { int: model.balance },
    },
    ...(secondary ? { secondaryLoyaltyPoints: { label: secondary.label, balance: { string: secondary.value } } } : {}),
    barcode: { type: BARCODES[model.design.barcode] ?? 'QR_CODE', value: model.barcode, alternateText: model.code },
    ...(heroImage ? { heroImage } : {}),
    linksModuleData: { uris: [{ uri: model.url, description: tx.open, id: 'card' }] },
    textModulesData: [...extra, ...back.filter((f) => f.key !== 'link' && f.key !== 'code')].map((f) => ({ id: f.key, header: f.label, body: f.value })),
  }
}

function giftClass(model, google, publicUrl, slug) {
  return {
    id: giftClassId(google, slug),
    issuerName: model.merchant,
    merchantName: model.merchant,
    programLogo: logo(publicUrl, model),
    hexBackgroundColor: model.design.background,
    reviewStatus: 'UNDER_REVIEW',
    countryCode: 'SA',
    cardNumberLabel: 'رقم البطاقة',
    localizedCardNumberLabel: text('رقم البطاقة', 'Card number'),
  }
}

function giftObject(model, google, slug) {
  return {
    id: giftObjectId(google, model),
    classId: giftClassId(google, slug),
    state: model.status === 'voided' ? 'INACTIVE' : model.expiresAt && new Date(model.expiresAt) < new Date() ? 'EXPIRED' : 'ACTIVE',
    cardNumber: model.code,
    balance: { micros: String(model.balanceMinor * 10_000), currencyCode: 'SAR' },
    balanceUpdateTime: { date: model.updatedAt.toISOString() },
    barcode: { type: BARCODES[model.design.barcode] ?? 'QR_CODE', value: model.barcode, alternateText: model.code },
    linksModuleData: { uris: [{ uri: model.url, description: 'Card', id: 'card' }] },
    ...(model.expiresAt ? { validTimeInterval: { end: { date: new Date(model.expiresAt).toISOString() } } } : {}),
    ...(model.message ? { textModulesData: [{ id: 'msg', header: model.senderName || 'Message', body: model.message }] } : {}),
  }
}

/** Ensures class + object exist with current data, returns the Save-to-Wallet URL. */
export async function saveUrl(model, { google, publicUrl, slug }) {
  let objects
  if (model.kind === 'gift') {
    await upsert(google, 'giftCardClass', giftClass(model, google, publicUrl, slug))
    await upsert(google, 'giftCardObject', giftObject(model, google, slug))
    objects = { giftCardObjects: [{ id: giftObjectId(google, model) }] }
  } else {
    await upsert(google, 'loyaltyClass', loyaltyClass(model, google, publicUrl))
    await upsert(google, 'loyaltyObject', loyaltyObject(model, google, publicUrl))
    objects = { loyaltyObjects: [{ id: loyaltyObjectId(google, model) }] }
  }
  const jwt = signJwt(
    { iss: google.serviceAccount.client_email, aud: 'google', typ: 'savetowallet', origins: [publicUrl], payload: objects },
    google.serviceAccount,
  )
  return `https://pay.google.com/gp/v/save/${jwt}`
}

/** Pushes current balance to an already-saved object. Missing objects (never saved) are ignored. */
export async function updateObject(model, { google, slug, publicUrl }) {
  if (model.kind === 'gift') return call(google, 'PATCH', `/giftCardObject/${encodeURIComponent(giftObjectId(google, model))}`, giftObject(model, google, slug))
  return call(google, 'PATCH', `/loyaltyObject/${encodeURIComponent(loyaltyObjectId(google, model))}`, loyaltyObject(model, google, publicUrl))
}

/** Pushes a program's name/colours/logo to its Google class (objects only carry per-member data). */
export function updateClass(model, { google, publicUrl }) {
  return call(google, 'PATCH', `/loyaltyClass/${encodeURIComponent(loyaltyClassId(google, model.programId))}`, loyaltyClass(model, google, publicUrl))
}

/** Marks a superseded pass (after reissue) inactive. */
export function deactivateLoyalty(model, { google }) {
  return call(google, 'PATCH', `/loyaltyObject/${encodeURIComponent(loyaltyObjectId(google, model))}`, { state: 'INACTIVE' })
}

export { loyaltyObject as _loyaltyObjectForTests, signJwt as _signJwtForTests }
