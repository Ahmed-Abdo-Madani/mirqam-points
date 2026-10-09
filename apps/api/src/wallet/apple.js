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
import { PASS_TEXT, rgb } from './model.js'
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
    barcodes: [{ format: 'PKBarcodeFormatQR', message: model.barcode, messageEncoding: 'iso-8859-1', altText: model.code }],
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
  const balanceValue = model.type === 'stamps' && model.stampsRequired ? `${model.balance} / ${model.stampsRequired}` : model.balance
  return {
    ...base,
    storeCard: {
      headerFields: [{ key: 'balance', label: unit, value: balanceValue, changeMessage: tx.balanceNow }],
      primaryFields: [{ key: 'program', label: tx.program, value: model.programName }],
      secondaryFields: [{ key: 'member', label: tx.member, value: model.memberName || '—' }],
      backFields: [
        { key: 'code', label: tx.code, value: model.code },
        ...(model.design.rewardText ? [{ key: 'reward', label: tx.reward, value: model.design.rewardText }] : []),
        { key: 'terms', label: tx.terms, value: tx.loyaltyTerms },
        { key: 'link', label: tx.details, value: model.url },
      ],
    },
  }
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
export function buildPkpass(model, ctx) {
  const files = { 'pass.json': Buffer.from(JSON.stringify(passJson(model, ctx))), ...passImages() }
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
