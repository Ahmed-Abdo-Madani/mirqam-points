import crypto from 'node:crypto'
import { inflateRawSync } from 'node:zlib'
import forge from 'node-forge'
import { describe, expect, it } from 'vitest'
import { buildPkpass, passJson, pushToDevices } from './apple.js'
import { _loyaltyObjectForTests, _signJwtForTests, addMessage, loyaltyObjectId } from './google.js'
import { normalizeDesign, parseSerial } from './model.js'
import { decodePng, inspectLogo, renderStrip } from './strip.js'
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

describe('card design', () => {
  const designed = (raw) => ({ ...model, passToken: 'tok'.repeat(10), lifetime: 42, design: normalizeDesign(raw) })

  it('normalizeDesign drops unknown values and caps lists', () => {
    const d = normalizeDesign({
      layout: 'nope',
      barcode: 'pdf417',
      stampShape: 'star',
      background: 'red',
      front: ['member', 'lifetime', 'code', 'remaining', 'bogus'],
      back: ['terms', 'terms', 'x'],
      notes: [{ label: ' Phone ', value: '0500' }, { label: '', value: 'x' }, ...Array.from({ length: 9 }, (_, i) => ({ label: `n${i}`, value: 'v' }))],
    })
    expect(d).toMatchObject({ layout: 'classic', barcode: 'pdf417', stampShape: 'star', background: '#172740', back: ['terms'] })
    expect(d.front).toEqual(['member', 'lifetime', 'code'])
    expect(d.notes).toHaveLength(6)
    expect(d.notes[0]).toEqual({ label: 'Phone', value: '0500' })
  })

  it('PDF417 and the front/back field choices reach pass.json', () => {
    const json = passJson(designed({ barcode: 'pdf417', front: ['member', 'lifetime'], back: ['code'], notes: [{ label: 'Phone', value: '0550394276' }] }), ctx)
    expect(json.barcodes[0].format).toBe('PKBarcodeFormatPDF417')
    expect(json.storeCard.secondaryFields.map((f) => f.key)).toEqual(['member', 'lifetime'])
    expect(json.storeCard.backFields.map((f) => f.key)).toEqual(['code', 'note0'])
  })

  it('branches become Google Maps links on the back and Apple "nearby" locations', () => {
    const branches = [
      { name: 'Olaya', latitude: 24.7136, longitude: 46.6753 },
      { name: 'Jeddah', mapsUrl: 'https://www.google.com/maps/place/X/@21.5,39.2,17z' },
    ]
    const json = passJson(designed({ back: ['code'], locations: branches, nearby: true, nearbyText: 'Visit us, we miss you' }), ctx)
    const back = json.storeCard.backFields
    expect(back.map((f) => f.key)).toEqual(['code', 'branch0', 'branch1'])
    expect(back[1]).toMatchObject({ label: 'Olaya', value: 'https://www.google.com/maps/search/?api=1&query=24.7136,46.6753' })
    expect(back[1].attributedValue).toMatch(/^<a href="https:\/\/www\.google\.com\/maps\/search\/.+">.+<\/a>$/)
    expect(back[2].value).toBe('https://www.google.com/maps/place/X/@21.5,39.2,17z')
    expect(json.locations).toEqual([
      { latitude: 24.7136, longitude: 46.6753, relevantText: 'Visit us, we miss you' },
      { latitude: 21.5, longitude: 39.2, relevantText: 'Visit us, we miss you' },
    ])
    // Nearby notices off: links stay, no lock-screen locations.
    expect(passJson(designed({ locations: branches, nearby: false }), ctx).locations).toBeUndefined()
    const obj = _loyaltyObjectForTests(designed({ locations: branches }), { issuerId: '1' }, 'https://points.example')
    expect(obj.linksModuleData.uris.map((u) => u.id)).toEqual(['card', 'branch0', 'branch1'])
    expect(obj.textModulesData.some((t) => t.id.startsWith('branch'))).toBe(false)
  })

  it('custom stamps: PNGs decode and are drawn on the strip, faded when not earned; no image falls back to circles', () => {
    const art = decodePng(renderStrip({ width: 64, height: 64, total: 1, filled: 1, shape: 'star', color: '#ff0000' }))
    expect(art).toMatchObject({ width: 64, height: 64 })
    const strip = decodePng(renderStrip({ width: 300, height: 100, total: 3, filled: 1, shape: 'custom', image: art }))
    const alphaAt = (x, y) => strip.rgba[(y * 300 + x) * 4 + 3]
    expect(alphaAt(50, 50)).toBeGreaterThan(200) // earned: full colour
    expect(alphaAt(150, 50)).toBeGreaterThan(0)
    expect(alphaAt(150, 50)).toBeLessThan(100) // not yet: faded
    expect(strip.rgba[(50 * 300 + 50) * 4]).toBe(255) // keeps the artwork's own colour
    expect(decodePng(renderStrip({ width: 60, height: 20, total: 2, filled: 1, shape: 'custom' }))).not.toBeNull()
    expect(decodePng(Buffer.from('not a png'))).toBeNull()
  })

  it('layouts rearrange the card face', () => {
    expect(passJson(designed({ layout: 'balance' }), ctx).storeCard.primaryFields[0].key).toBe('balance')
    const strip = passJson(designed({ layout: 'strip' }), ctx).storeCard
    expect(strip.primaryFields).toBeUndefined()
    expect(strip.headerFields[0].key).toBe('balance')
    // A points program has no stamps to draw, so "strip" falls back to the classic face.
    expect(passJson({ ...designed({ layout: 'strip' }), type: 'points', stampsRequired: null }, ctx).storeCard.primaryFields[0].key).toBe('program')
  })

  it('strip layout ships stamp artwork and a merchant logo replaces the Mirqam mark', () => {
    const logo = renderStrip({ width: 96, height: 96, total: 1, filled: 1 })
    const files = unzip(buildPkpass(designed({ layout: 'strip', stampShape: 'heart' }), ctx, { logo }))
    for (const name of ['strip.png', 'strip@2x.png', 'strip@3x.png']) expect(files[name].subarray(1, 4).toString()).toBe('PNG')
    expect(files['strip@2x.png'].readUInt32BE(16)).toBe(750)
    expect(files['logo.png'].equals(logo)).toBe(true)
    expect(files['icon.png'].equals(logo)).toBe(true)
    const manifest = JSON.parse(files['manifest.json'])
    expect(Object.keys(manifest)).toContain('strip.png')
  })

  it('stamp strips are valid PNGs of the requested size, and logo validation rejects junk', () => {
    const png = renderStrip({ width: 300, height: 100, total: 21, filled: 7, shape: 'square', color: '#336699' })
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([300, 100])
    expect(inspectLogo(png)).toEqual({ width: 300, height: 100 })
    expect(inspectLogo(renderStrip({ width: 20, height: 20, total: 1, filled: 0 }))).toBeNull() // too small to be a logo
    expect(inspectLogo(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'.padEnd(64)))).toBeNull()
  })

  it('Google objects follow the design: barcode type, secondary points, hero image', () => {
    const obj = _loyaltyObjectForTests(
      designed({ layout: 'strip', barcode: 'aztec', front: ['member', 'remaining'], notes: [{ label: 'Phone', value: '055' }] }),
      { issuerId: '1' },
      'https://points.example',
    )
    expect(obj.barcode.type).toBe('AZTEC')
    expect(obj.secondaryLoyaltyPoints).toMatchObject({ label: 'المتبقي', balance: { string: '5' } })
    expect(obj.heroImage.sourceUri.uri).toMatch(/^https:\/\/points\.example\/api\/public\/pass\/tok.+\/strip\.png\?v=\d+$/)
    expect(obj.textModulesData.some((t) => t.header === 'Phone' && t.body === '055')).toBe(true)
  })
})

describe('campaign delivery', () => {
  it('Apple: one APNs connection delivers a push to every registered device token', async () => {
    const http2 = await import('node:http2')
    const seen = []
    const server = http2.createSecureServer({ cert: apple.certPem, key: apple.keyPem })
    server.on('stream', (stream, headers) => {
      seen.push({ path: headers[':path'], topic: headers['apns-topic'] })
      stream.respond({ ':status': 200 })
      stream.end()
    })
    await new Promise((r) => server.listen(0, '127.0.0.1', r))
    const previous = process.env.NODE_TLS_REJECT_UNAUTHORIZED
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0' // the fake APNs uses a throwaway certificate
    try {
      const result = await pushToDevices(['tokA', 'tokB'], { ...apple, apnsHost: `https://127.0.0.1:${server.address().port}` })
      expect(result).toEqual({ sent: 2, failed: 0, invalid: [] })
      expect(seen.map((s) => s.path).sort()).toEqual(['/3/device/tokA', '/3/device/tokB'])
      expect(seen.every((s) => s.topic === apple.passTypeId)).toBe(true)
    } finally {
      if (previous === undefined) delete process.env.NODE_TLS_REJECT_UNAUTHORIZED
      else process.env.NODE_TLS_REJECT_UNAUTHORIZED = previous
      server.close()
    }
  })

  it('Google: addMessage posts a TEXT_AND_NOTIFY message to the pass object', async () => {
    const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 })
    const google = {
      issuerId: '123',
      serviceAccount: { client_email: 'svc@test.iam.gserviceaccount.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) },
    }
    const calls = []
    const realFetch = globalThis.fetch
    globalThis.fetch = async (url, init) => {
      calls.push({ url: String(url), body: init?.body })
      return new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600 }), { status: 200 })
    }
    try {
      await addMessage(model, { id: 'c-1', title: 'Weekend offer', body: 'Double stamps' }, { google })
    } finally {
      globalThis.fetch = realFetch
    }
    const post = calls.find((c) => c.url.endsWith('/addMessage'))
    expect(post.url).toContain(`/loyaltyObject/${encodeURIComponent(loyaltyObjectId(google, model))}/addMessage`)
    expect(JSON.parse(post.body).message).toEqual({ id: 'msg_c-1', header: 'Weekend offer', body: 'Double stamps', messageType: 'TEXT_AND_NOTIFY' })
  })
})
