/* Apple Wallet: .pkpass generation (pass.json + images + manifest + PKCS#7
   detached signature) and APNs pushes that tell devices to re-fetch a pass.
   Requires a Pass Type ID certificate (signer cert + key) and Apple's WWDR
   intermediate. Without them Apple Wallet is reported as not configured. */
import crypto from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import http2 from 'node:http2'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import forge from 'node-forge'
import { loyaltyFields, PASS_TEXT, rgb } from './model.js'
import { renderStrip } from './strip.js'
import { zip } from './zip.js'

const ASSETS = join(dirname(fileURLToPath(import.meta.url)), '../../assets/pass')
let images
function passImages() {
  images ??= Object.fromEntries(
    readdirSync(ASSETS)
      .filter((f) => f.endsWith('.png'))
      .map((f) => [f, readFileSync(join(ASSETS, f))]),
  )
  return images
}

export function appleConfigured(apple) {
  return Boolean(apple.passTypeId && apple.teamId && apple.certPem && apple.keyPem && apple.wwdrPem)
}

const FORMATS = { qr: 'PKBarcodeFormatQR', pdf417: 'PKBarcodeFormatPDF417', aztec: 'PKBarcodeFormatAztec', code128: 'PKBarcodeFormatCode128' }

const money = (minor) => (minor / 100).toFixed(2)

export function passJson(model, { apple, publicUrl }) {
  const tx = PASS_TEXT[model.locale === 'en' ? 'en' : 'ar']
  const base = {
    formatVersion: 1,
    passTypeIdentifier: apple.passTypeId,
    teamIdentifier: apple.teamId,
    serialNumber: model.serial,
    authenticationToken: model.authToken,
    webServiceURL: `${publicUrl}/api/wallet/apple`,
    organizationName: model.merchant,
    description: model.kind === 'gift' ? `${model.merchant} — ${tx.giftCard}` : `${model.merchant} — ${model.programName}`,
    logoText: model.merchant,
    foregroundColor: rgb(model.design.foreground),
    backgroundColor: rgb(model.design.background),
    labelColor: rgb(model.design.label),
    sharingProhibited: true,
    barcodes: [{ format: FORMATS[model.design.barcode] ?? FORMATS.qr, message: model.barcode, messageEncoding: 'iso-8859-1', altText: model.code }],
  }
  if (model.kind === 'gift') {
    return {
      ...base,
      ...(model.expiresAt ? { expirationDate: new Date(model.expiresAt).toISOString() } : {}),
      ...(model.status === 'voided' ? { voided: true } : {}),
      storeCard: {
        headerFields: [{ key: 'balance', label: tx.balance, value: Number(money(model.balanceMinor)), currencyCode: 'SAR', changeMessage: tx.balanceNow }],
        primaryFields: [{ key: 'title', label: tx.giftCard, value: model.merchant }],
        secondaryFields: [
          ...(model.recipientName ? [{ key: 'to', label: tx.member, value: model.recipientName }] : []),
          ...(model.senderName ? [{ key: 'from', label: tx.from, value: model.senderName }] : []),
        ],
        backFields: [
          { key: 'code', label: tx.code, value: model.code },
          ...(model.message ? [{ key: 'message', label: tx.message, value: model.message }] : []),
          { key: 'terms', label: tx.terms, value: tx.giftTerms },
          { key: 'link', label: tx.details, value: model.url },
        ],
      },
    }
  }
  const unit = model.type === 'stamps' ? tx.stamps : tx.points
  const stamps = model.type === 'stamps' && model.stampsRequired
  const balanceValue = stamps ? `${model.balance} / ${model.stampsRequired}` : model.balance
  const { front, back: backFields } = loyaltyFields(model, tx)
  // A changed message field with changeMessage is what makes Wallet raise a lock-screen notification.
  const back = backFields.map((f) => (f.key === 'message' ? { ...f, changeMessage: '%@' } : f))
  const balanceField = { key: 'balance', label: unit, value: balanceValue, changeMessage: tx.balanceNow }
  const layout = model.design.layout === 'strip' && !stamps ? 'classic' : model.design.layout
  const card =
    layout === 'balance'
      ? { primaryFields: [balanceField], secondaryFields: [{ key: 'program', label: tx.program, value: model.programName }, ...front].slice(0, 4) }
      : layout === 'strip'
        ? { headerFields: [balanceField], secondaryFields: front }
        : { headerFields: [balanceField], primaryFields: [{ key: 'program', label: tx.program, value: model.programName }], secondaryFields: front }
  return { ...base, storeCard: { ...card, backFields: back } }
}

function signManifest(manifest, apple) {
  const cert = forge.pki.certificateFromPem(apple.certPem)
  const key = apple.keyPassphrase ? forge.pki.decryptRsaPrivateKey(apple.keyPem, apple.keyPassphrase) : forge.pki.privateKeyFromPem(apple.keyPem)
  if (!key) throw new Error('Apple pass key could not be decrypted')
  const p7 = forge.pkcs7.createSignedData()
  p7.content = forge.util.createBuffer(manifest.toString('binary'))
  p7.addCertificate(cert)
  p7.addCertificate(forge.pki.certificateFromPem(apple.wwdrPem))
  p7.addSigner({
    key,
    certificate: cert,
    digestAlgorithm: forge.pki.oids.sha256,
    authenticatedAttributes: [
      { type: forge.pki.oids.contentType, value: forge.pki.oids.data },
      { type: forge.pki.oids.messageDigest },
      { type: forge.pki.oids.signingTime, value: new Date() },
    ],
  })
  p7.sign({ detached: true })
  return Buffer.from(forge.asn1.toDer(p7.toAsn1()).getBytes(), 'binary')
}

/** Builds a signed .pkpass buffer. */
export function buildPkpass(model, ctx, { logo } = {}) {
  const files = { 'pass.json': Buffer.from(JSON.stringify(passJson(model, ctx))), ...passImages() }
  if (logo) {
    // The merchant's logo replaces Mirqam's mark on the card and in notifications.
    for (const name of ['logo.png', 'logo@2x.png', 'logo@3x.png', 'icon.png', 'icon@2x.png', 'icon@3x.png']) files[name] = logo
  }
  if (model.kind === 'loyalty' && model.design.layout === 'strip' && model.type === 'stamps' && model.stampsRequired) {
    for (const [name, scale] of [
      ['strip.png', 1],
      ['strip@2x.png', 2],
      ['strip@3x.png', 3],
    ]) {
      files[name] = renderStrip({
        width: 375 * scale,
        height: 123 * scale,
        total: model.stampsRequired,
        filled: Math.min(model.balance, model.stampsRequired),
        shape: model.design.stampShape,
        color: model.design.stampColor,
      })
    }
  }
  const manifest = Buffer.from(
    JSON.stringify(Object.fromEntries(Object.entries(files).map(([name, data]) => [name, crypto.createHash('sha1').update(data).digest('hex')]))),
  )
  return zip({ ...files, 'manifest.json': manifest, signature: signManifest(manifest, ctx.apple) })
}

/** Silent push to each device token so Wallet calls back for the updated pass. */
export async function pushToDevices(pushTokens, apple) {
  if (!pushTokens.length) return { sent: 0, failed: 0, invalid: [] }
  const session = http2.connect(apple.apnsHost, { cert: apple.certPem, key: apple.keyPem, passphrase: apple.keyPassphrase || undefined })
  // An unreachable APNs must never crash the process: an unhandled 'error' event on the session would.
  session.on('error', (err) => console.warn(`[wallet] apns session: ${err.message}`))
  const result = { sent: 0, failed: 0, invalid: [] }
  try {
    await Promise.all(
      pushTokens.map(
        (token) =>
          new Promise((resolve) => {
            const req = session.request({
              ':method': 'POST',
              ':path': `/3/device/${token}`,
              'apns-topic': apple.passTypeId,
              'content-type': 'application/json',
            })
            req.setTimeout(10_000, () => req.close())
            req.on('response', (headers) => {
              const status = headers[':status']
              if (status === 200) result.sent += 1
              else {
                result.failed += 1
                if (status === 410 || status === 400) result.invalid.push(token)
              }
            })
            req.on('error', () => {
              result.failed += 1
              resolve()
            })
            req.on('close', resolve)
            req.end('{}')
          }),
      ),
    )
  } finally {
    session.close()
  }
  return result
}
