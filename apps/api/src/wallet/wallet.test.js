import crypto from 'node:crypto'
import { inflateRawSync } from 'node:zlib'
import forge from 'node-forge'
import { describe, expect, it } from 'vitest'
import { buildPkpass, passJson } from './apple.js'
import { _signJwtForTests, loyaltyObjectId } from './google.js'
import { normalizeDesign, parseSerial } from './model.js'
import { testAppleCredentials } from './test-certs.js'

/* Reads our STORE-only zip back into { name: Buffer }. */
function unzip(buf) {
  const files = {}
  let i = 0
  while (buf.readUInt32LE(i) === 0x04034b50) {
    const method = buf.readUInt16LE(i + 8)
    const size = buf.readUInt32LE(i + 18)
    const nameLen = buf.readUInt16LE(i + 26)
    const extra = buf.readUInt16LE(i + 28)
    const name = buf.subarray(i + 30, i + 30 + nameLen).toString()
    const data = buf.subarray(i + 30 + nameLen + extra, i + 30 + nameLen + extra + size)
    files[name] = method === 8 ? inflateRawSync(data) : data
    i += 30 + nameLen + extra + size
  }
  return files
}

const apple = testAppleCredentials()
const ctx = { apple, publicUrl: 'https://points.example' }
const model = {
  kind: 'loyalty',
  id: '0b5c1c1e-1111-4222-8333-944455556666',
  serial: 'acct-0b5c1c1e-1111-4222-8333-944455556666-v1',
  version: 1,
  authToken: 'a'.repeat(32),
  merchant: 'مقهى السحاب',
  programId: 'p1',
  programName: 'بطاقة القهوة',
  type: 'stamps',
  balance: 3,
  stampsRequired: 8,
  memberName: 'نورة',
  locale: 'ar',
  barcode: 'MP:ABCDEF1234',
  code: 'ABCDEF1234',
  design: normalizeDesign({ background: '#123456', rewardText: 'قهوة مجانية' }),
  url: 'https://points.example/p/token',
  updatedAt: new Date(),
}

describe('apple wallet', () => {
  it('pass.json carries identity, web service, barcode and Arabic fields', () => {
    const json = passJson(model, ctx)
    expect(json).toMatchObject({
      formatVersion: 1,
      passTypeIdentifier: 'pass.test.points',
      teamIdentifier: 'TESTTEAM01',
      serialNumber: model.serial,
      webServiceURL: 'https://points.example/api/wallet/apple',
      backgroundColor: 'rgb(18, 52, 86)',
      sharingProhibited: true,
    })
    expect(json.barcodes[0]).toMatchObject({ format: 'PKBarcodeFormatQR', message: 'MP:ABCDEF1234' })
    expect(json.storeCard.headerFields[0].value).toBe('3 / 8')
    expect(json.storeCard.backFields.some((f) => f.value === 'قهوة مجانية')).toBe(true)
  })

  it('builds a signed .pkpass whose manifest matches every file', () => {
    const files = unzip(buildPkpass(model, ctx))
    expect(Object.keys(files)).toEqual(expect.arrayContaining(['pass.json', 'manifest.json', 'signature', 'icon.png', 'icon@2x.png', 'logo.png']))
    const manifest = JSON.parse(files['manifest.json'])
    for (const [name, digest] of Object.entries(manifest)) {
      expect(crypto.createHash('sha1').update(files[name]).digest('hex'), name).toBe(digest)
    }
    // Detached PKCS#7 over the manifest, carrying signer + WWDR certificates.
    const p7 = forge.pkcs7.messageFromAsn1(forge.asn1.fromDer(files.signature.toString('binary')))
    expect(p7.certificates).toHaveLength(2)
    expect(p7.rawCapture.content).toBeUndefined()
  })

  it('gift card passes show money and void state', () => {
    const json = passJson(
      {
        ...model,
        kind: 'gift',
        serial: 'gift-x',
        balanceMinor: 12550,
        status: 'voided',
        expiresAt: '2027-01-01',
        recipientName: 'سارة',
        senderName: '',
        message: '',
      },
      ctx,
    )
    expect(json.storeCard.headerFields[0]).toMatchObject({ value: 125.5, currencyCode: 'SAR' })
    expect(json.voided).toBe(true)
  })
})

describe('serials', () => {
  it('round-trip', () => {
    expect(parseSerial(model.serial)).toEqual({ kind: 'loyalty', id: model.id, version: 1 })
    expect(parseSerial(`gift-${model.id}`)).toEqual({ kind: 'gift', id: model.id })
    expect(parseSerial('acct-nope')).toBeNull()
  })
})

describe('google wallet', () => {
  it('signs RS256 JWTs verifiable with the service account key', () => {
    const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 })
    const sa = { client_email: 'svc@test.iam.gserviceaccount.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) }
    const jwt = _signJwtForTests({ aud: 'google', typ: 'savetowallet', payload: {} }, sa)
    const [h, b, s] = jwt.split('.')
    expect(JSON.parse(Buffer.from(h, 'base64url'))).toEqual({ alg: 'RS256', typ: 'JWT' })
    expect(crypto.createVerify('RSA-SHA256').update(`${h}.${b}`).verify(publicKey, s, 'base64url')).toBe(true)
  })

  it('object ids are issuer-scoped and versioned', () => {
    expect(loyaltyObjectId({ issuerId: '3388000000023218379' }, model)).toBe('3388000000023218379.acct_0b5c1c1e-1111-4222-8333-944455556666_v1')
  })
})
