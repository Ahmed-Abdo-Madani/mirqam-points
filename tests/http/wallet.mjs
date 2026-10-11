/* HTTP battery: wallet passes, self-enrollment, gift cards, native-app auth,
   account deletion. The gate boots the server with a throwaway Apple
   certificate chain (APPLE_* env) and without Google credentials. */
import { renderStrip } from '../../apps/api/src/wallet/strip.js'
import { Agent, check, expect, expectStatus, key, passJsonFrom, phone, uniq } from './harness.mjs'

const hdr = () => ({ headers: { 'idempotency-key': key() } })

async function program(owner, extra = {}) {
  const p = await owner.post('/api/programs', { name: 'Coffee', type: 'stamps', config: { stampsPerVisit: 1, stampsRequired: 8 }, ...extra })
  expectStatus(p, 201)
  expectStatus(await owner.patch(`/api/programs/${p.body.id}`, { status: 'active' }), 200)
  return p.body
}

async function memberWithCard(owner, prog) {
  const m = await owner.post('/api/members', { phone: phone(), name: 'Noura' })
  expectStatus(m, 201)
  const acct = await owner.post(`/api/members/${m.body.id}/accounts`, { programId: prog.id })
  expectStatus(acct, 201)
  return { member: m.body, account: acct.body, token: acct.body.passPath.split('/').pop() }
}

// ---------------------------------------------------------------- passes
await check('wallet status reflects configured platforms', async () => {
  const a = await Agent.owner()
  const s = await a.get('/api/wallet/status')
  expectStatus(s, 200)
  expect(s.body.apple, 'apple').toBe(true)
  expect(s.body.google, 'google').toBe(false)
})

await check('member card: public pass page, Apple .pkpass download, Google 503 when unconfigured', async () => {
  const owner = await Agent.owner()
  const prog = await program(owner, { design: { background: '#0f6f74', rewardText: 'Free coffee' } })
  const { token, account } = await memberWithCard(owner, prog)
  const pub = await new Agent().get(`/api/public/pass/${token}`)
  expectStatus(pub, 200)
  expect(pub.body.code).toBe(account.code)
  expect(pub.body.design.background).toBe('#0f6f74')
  expect(Boolean(pub.body.wallet.apple)).toBe(true)
  expect(pub.body.wallet.google).toBe(null)
  const pk = await new Agent().get(`/api/public/pass/${token}/apple.pkpass`)
  expectStatus(pk, 200)
  expect(pk.headers.get('content-type')).toMatch(/application\/vnd\.apple\.pkpass/)
  expectStatus(await new Agent().get(`/api/public/pass/${token}/google`), 503, 'google_wallet_unavailable')
  expectStatus(await new Agent().get(`/api/public/pass/${'x'.repeat(40)}`), 404, 'pass_not_found')
})

await check('cashier finds a member by scanning the card code', async () => {
  const owner = await Agent.owner()
  const prog = await program(owner)
  const { member, account } = await memberWithCard(owner, prog)
  const found = await owner.get(`/api/members/lookup?code=${encodeURIComponent(`MP:${account.code}`)}`)
  expectStatus(found, 200)
  expect(found.body.id).toBe(member.id)
  expect(found.body.matchedProgramId).toBe(prog.id)
  const other = await Agent.owner()
  expectStatus(await other.get(`/api/members/lookup?code=MP:${account.code}`), 404, 'member_not_found')
})

await check('Apple PassKit web service: register, list updates, fetch, 304, unregister; bad token refused', async () => {
  const owner = await Agent.owner()
  const prog = await program(owner)
  const { token, member } = await memberWithCard(owner, prog)
  // Like a real device: the serial, auth token and web service URL come from the downloaded pass.
  const pk = await new Agent().request('GET', `/api/public/pass/${token}/apple.pkpass`, { binary: true })
  expectStatus(pk, 200)
  const pass = passJsonFrom(pk.body)
  expect(pass.webServiceURL).toMatch(/\/api\/wallet\/apple$/)
  const base = `/api/wallet/apple/v1/devices/device-${uniq()}/registrations/${pass.passTypeIdentifier}`
  const auth = { authorization: `ApplePass ${pass.authenticationToken}` }
  const device = new Agent()

  expectStatus(
    await device.request('POST', `${base}/${pass.serialNumber}`, { body: { pushToken: 'push-1' }, headers: { authorization: 'ApplePass wrong-token' } }),
    401,
  )
  expectStatus(await device.request('POST', `${base}/${pass.serialNumber}`, { body: { pushToken: 'push-1' }, headers: auth }), 201)
  expectStatus(await device.request('POST', `${base}/${pass.serialNumber}`, { body: { pushToken: 'push-1' }, headers: auth }), 200)

  const first = await device.get(`${base}?passesUpdatedSince=0`)
  expectStatus(first, 200)
  expect(first.body.serialNumbers[0]).toBe(pass.serialNumber)
  const tag = first.body.lastUpdated
  expectStatus(await device.get(`${base}?passesUpdatedSince=${tag}`), 204)

  // A purchase changes the balance: the pass is listed as updated again.
  await new Promise((r) => setTimeout(r, 20))
  expectStatus(await owner.post('/api/ledger/earn', { programId: prog.id, memberId: member.id, purchaseMinor: 1000 }, hdr()), 201)
  const after = await device.get(`${base}?passesUpdatedSince=${tag}`)
  expectStatus(after, 200)
  expect(after.body.serialNumbers.length).toBe(1)

  const fetchPath = `/api/wallet/apple/v1/passes/${pass.passTypeIdentifier}/${pass.serialNumber}`
  const fresh = await device.request('GET', fetchPath, { headers: auth, binary: true })
  expectStatus(fresh, 200)
  expect(passJsonFrom(fresh.body).storeCard.headerFields[0].value).toBe('1 / 8')
  expectStatus(await device.request('GET', fetchPath, { headers: { ...auth, 'if-modified-since': new Date(Date.now() + 60_000).toUTCString() } }), 304)
  expectStatus(await device.request('GET', fetchPath, { headers: { authorization: 'ApplePass nope' } }), 401)

  expectStatus(await device.request('DELETE', `${base}/${pass.serialNumber}`, { headers: auth }), 200)
  expectStatus(await device.get(`${base}?passesUpdatedSince=0`), 204)
  expectStatus(await device.request('POST', '/api/wallet/apple/v1/log', { body: { logs: ['test log line'] } }), 200)
})

await check('reissue retires the old card: old code, token and serial stop working', async () => {
  const owner = await Agent.owner()
  const prog = await program(owner)
  const { member, account, token } = await memberWithCard(owner, prog)
  const re = await owner.post(`/api/members/${member.id}/accounts/${account.id}/reissue`, {})
  expectStatus(re, 200)
  expect(re.body.passVersion).toBe(2)
  expectStatus(await new Agent().get(`/api/public/pass/${token}`), 404, 'pass_not_found')
  expectStatus(await owner.get(`/api/members/lookup?code=${account.code}`), 404, 'member_not_found')
  expectStatus(await new Agent().get(`/api/public/pass/${re.body.passPath.split('/').pop()}`), 200)
  const cashier = await Agent.staff(owner, 'cashier')
  expectStatus(await cashier.post(`/api/members/${member.id}/accounts/${account.id}/reissue`, {}), 403, 'forbidden')
})

// ---------------------------------------------------------------- self-enrollment
await check('self-enrollment: only when enabled, only for new numbers, member starts unverified', async () => {
  const owner = await Agent.owner()
  const closed = await program(owner)
  const slug = owner.me.tenant.slug
  expectStatus(await new Agent().get(`/api/public/join/${slug}/${closed.id}`), 404, 'program_not_found')
  const open = await program(owner, { selfEnroll: true })
  const info = await new Agent().get(`/api/public/join/${slug}/${open.id}`)
  expectStatus(info, 200)
  expect(info.body.programName).toBe('Coffee')
  const p = phone()
  const visitor = new Agent()
  const joined = await visitor.post(`/api/public/join/${slug}/${open.id}`, { phone: p, name: 'Visitor', acceptTerms: true })
  expectStatus(joined, 201)
  expectStatus(await new Agent().get(`/api/public/pass/${joined.body.passToken}`), 200)
  // The same number cannot mint a second pass anonymously.
  expectStatus(await new Agent().post(`/api/public/join/${slug}/${open.id}`, { phone: p, acceptTerms: true }), 409, 'already_member')
  expectStatus(await new Agent().post(`/api/public/join/${slug}/${open.id}`, { phone: phone() }), 400, 'validation_failed')
  const list = await owner.get(`/api/members?q=${p.slice(-6)}`)
  expect(list.body.items[0].verified).toBe(false)
})

// ---------------------------------------------------------------- gift cards
await check('gift cards: cashier sells, public page shows balance, partial redeem by code is idempotent', async () => {
  const owner = await Agent.owner()
  const cashier = await Agent.staff(owner, 'cashier')
  const sold = await cashier.post('/api/gift-cards', { amountMinor: 25000, recipientName: 'Sara', senderName: 'Ali', message: 'Happy birthday' }, hdr())
  expectStatus(sold, 201)
  expect(sold.body.code).toMatch(/^[0-9A-Z]{4}(-[0-9A-Z]{4}){3}$/)
  const token = sold.body.card.publicToken
  const page = await new Agent().get(`/api/public/gift/${token}`)
  expectStatus(page, 200)
  expect(page.body.balanceMinor).toBe(25000)
  expect(page.body.code).toBe(sold.body.code)
  const k = key()
  const r1 = await cashier.post('/api/gift-cards/redeem', { code: sold.body.code.toLowerCase(), amountMinor: 10050 }, { headers: { 'idempotency-key': k } })
  expectStatus(r1, 201)
  expect(r1.body.card.balanceMinor).toBe(14950)
  const r2 = await cashier.post('/api/gift-cards/redeem', { code: sold.body.code, amountMinor: 10050 }, { headers: { 'idempotency-key': k } })
  expectStatus(r2, 200)
  expect(r2.body.replayed).toBe(true)
  expectStatus(await cashier.post('/api/gift-cards/redeem', { code: sold.body.code, amountMinor: 15000 }, hdr()), 422, 'insufficient_balance')
  const pk = await new Agent().get(`/api/public/gift/${token}/apple.pkpass`)
  expectStatus(pk, 200)
  const list = await owner.get('/api/gift-cards')
  expect(list.body.outstandingMinor).toBe(14950)
})

await check('gift cards: freeze blocks spending, void writes off; cashier cannot do either; tenants isolated', async () => {
  const owner = await Agent.owner()
  const cashier = await Agent.staff(owner, 'cashier')
  const sold = await owner.post('/api/gift-cards', { amountMinor: 5000 }, hdr())
  const id = sold.body.card.id
  expectStatus(await cashier.post(`/api/gift-cards/${id}/status`, { status: 'frozen' }), 403, 'forbidden')
  expectStatus(await owner.post(`/api/gift-cards/${id}/status`, { status: 'frozen' }), 200)
  expectStatus(await cashier.post('/api/gift-cards/redeem', { code: sold.body.code, amountMinor: 100 }, hdr()), 422, 'gift_card_frozen')
  expectStatus(await owner.post(`/api/gift-cards/${id}/status`, { status: 'active' }), 200)
  expectStatus(await owner.post(`/api/gift-cards/${id}/void`, { note: 'refund' }, hdr()), 201)
  expectStatus(await cashier.post('/api/gift-cards/redeem', { code: sold.body.code, amountMinor: 100 }, hdr()), 422, 'gift_card_voided')
  const detail = await owner.get(`/api/gift-cards/${id}`)
  expect(detail.body.entries.map((e) => e.kind).join(',')).toBe('void,issue')
  const other = await Agent.owner()
  expectStatus(await other.post('/api/gift-cards/lookup', { code: sold.body.code }), 404, 'gift_card_not_found')
  expectStatus(await other.get(`/api/gift-cards/${id}`), 404, 'gift_card_not_found')
  expectStatus(await new Agent().get('/api/gift-cards'), 401, 'unauthenticated')
})

await check('gift cards: amounts validated, analyst cannot sell', async () => {
  const owner = await Agent.owner()
  expectStatus(await owner.post('/api/gift-cards', { amountMinor: 50 }, hdr()), 400, 'validation_failed')
  expectStatus(await owner.post('/api/gift-cards', { amountMinor: 1000, recipientPhone: '123' }, hdr()), 400, 'validation_failed')
  const analyst = await Agent.staff(owner, 'analyst')
  expectStatus(await analyst.post('/api/gift-cards', { amountMinor: 1000 }, hdr()), 403, 'forbidden')
})

// ---------------------------------------------------------------- native app
await check('native app: token sign-in, bearer requests, CORS for the app origin only', async () => {
  const owner = await Agent.owner()
  const app = new Agent()
  const login = await app.post(
    '/api/auth/login',
    { email: owner.me.user.email, password: 'correct-horse-9' },
    { headers: { 'x-mp-client': 'mobile', origin: 'capacitor://localhost' } },
  )
  expectStatus(login, 200)
  expect(typeof login.body.token).toBe('string')
  expect(login.headers.get('set-cookie')).toBe(null)
  expect(login.headers.get('access-control-allow-origin')).toBe('capacitor://localhost')
  const bearer = { authorization: `Bearer ${login.body.token}`, origin: 'capacitor://localhost' }
  const me = await new Agent().get('/api/auth/me', { headers: bearer })
  expectStatus(me, 200)
  expectStatus(await new Agent().post('/api/programs', { name: 'from app', type: 'points' }, { headers: bearer }), 201)
  const pre = await new Agent().request('OPTIONS', '/api/programs', { headers: { origin: 'capacitor://localhost', 'access-control-request-method': 'POST' } })
  expect(pre.status).toBe(204)
  const evil = await new Agent().request('OPTIONS', '/api/programs', { headers: { origin: 'https://evil.example', 'access-control-request-method': 'POST' } })
  expect(evil.headers.get('access-control-allow-origin')).toBe(null)
  // A cookie session can never be driven from the app origin.
  expectStatus(await owner.post('/api/programs', { name: 'x', type: 'points' }, { headers: { origin: 'capacitor://localhost' } }), 403, 'origin_not_allowed')
})

// ---------------------------------------------------------------- card design
await check('card design: validated, stored, and reflected in the public pass and the .pkpass', async () => {
  const owner = await Agent.owner()
  const prog = await program(owner)
  const bad = [
    { barcode: 'ean13' },
    { layout: 'wild' },
    { front: ['member', 'lifetime', 'code', 'remaining'] },
    { notes: [{ label: 'x', value: '' }] },
    { background: 'red' },
    { extra: 1 },
  ]
  for (const design of bad) expectStatus(await owner.patch(`/api/programs/${prog.id}`, { design }), 400, 'validation_failed')
  const design = {
    layout: 'strip',
    barcode: 'pdf417',
    stampShape: 'heart',
    stampColor: '#6b3f27',
    front: ['member', 'remaining'],
    back: ['code', 'terms'],
    notes: [{ label: 'Phone', value: '0550394276' }],
  }
  const saved = await owner.patch(`/api/programs/${prog.id}`, { design })
  expectStatus(saved, 200)
  expect(saved.body.design.barcode).toBe('pdf417')
  const { token } = await memberWithCard(owner, prog)
  const pub = await new Agent().get(`/api/public/pass/${token}`)
  expect(pub.body.design.layout).toBe('strip')
  expect(pub.body.design.barcode).toBe('pdf417')
  expect(pub.body.design.stampShape).toBe('heart')
  const pk = await new Agent().request('GET', `/api/public/pass/${token}/apple.pkpass`, { binary: true })
  const pass = passJsonFrom(pk.body)
  expect(pass.barcodes[0].format).toBe('PKBarcodeFormatPDF417')
  expect(pass.storeCard.secondaryFields.map((f) => f.key)).toEqual(['member', 'remaining'])
  expect(pass.storeCard.backFields.map((f) => f.key)).toEqual(['code', 'terms', 'note0'])
  const strip = await new Agent().request('GET', `/api/public/pass/${token}/strip.png`, { binary: true })
  expectStatus(strip, 200)
  expect(strip.headers.get('content-type')).toBe('image/png')
  expect(strip.body.subarray(1, 4).toString()).toBe('PNG')
  // Cashiers cannot restyle the card.
  const cashier = await Agent.staff(owner, 'cashier')
  expectStatus(await cashier.patch(`/api/programs/${prog.id}`, { design: { barcode: 'qr' } }), 403, 'forbidden')
})

await check('merchant logo: PNG only, bounded, public, tenant-scoped, removable', async () => {
  const owner = await Agent.owner()
  const png = renderStrip({ width: 128, height: 128, total: 1, filled: 1 }).toString('base64')
  expectStatus(await owner.put('/api/branding/logo', { png: Buffer.from('<svg/>').toString('base64') }), 422, 'invalid_logo')
  expectStatus(
    await owner.put('/api/branding/logo', { png: renderStrip({ width: 16, height: 16, total: 1, filled: 1 }).toString('base64') }),
    422,
    'invalid_logo',
  )
  const set = await owner.put('/api/branding/logo', { png })
  expectStatus(set, 200)
  expect(set.body.logoUrl).toMatch(/^\/api\/public\/logo\/.+\?v=\d+$/)
  expect((await owner.get('/api/auth/me')).body.tenant.logoUrl).toBe(set.body.logoUrl)
  const pubLogo = await new Agent().request('GET', set.body.logoUrl, { binary: true })
  expectStatus(pubLogo, 200)
  expect(pubLogo.body.toString('base64')).toBe(png)
  const prog = await program(owner)
  const { token } = await memberWithCard(owner, prog)
  expect((await new Agent().get(`/api/public/pass/${token}`)).body.logoUrl).toBe(set.body.logoUrl)
  const cashier = await Agent.staff(owner, 'cashier')
  expectStatus(await cashier.put('/api/branding/logo', { png }), 403, 'forbidden')
  expectStatus(await new Agent().put('/api/branding/logo', { png }), 401, 'unauthenticated')
  const other = await Agent.owner()
  expect((await other.get('/api/auth/me')).body.tenant.logoUrl).toBe(null)
  expectStatus(await owner.delete('/api/branding/logo'), 200)
  expectStatus(await new Agent().get(set.body.logoUrl), 404, 'logo_not_found')
})

// ---------------------------------------------------------------- account deletion
await check('account deletion: needs the password; sole owner closes the workspace and staff lose access', async () => {
  const owner = await Agent.owner()
  const cashier = await Agent.staff(owner, 'cashier')
  expectStatus(await owner.post('/api/auth/delete-account', { password: 'nope-nope' }), 401, 'invalid_credentials')
  expectStatus(await owner.post('/api/auth/delete-account', { password: 'correct-horse-9' }), 200)
  expectStatus(await new Agent().post('/api/auth/login', { email: owner.me.user.email, password: 'correct-horse-9' }), 401, 'invalid_credentials')
  expectStatus(await cashier.get('/api/auth/me'), 401, 'unauthenticated')
  // The email can register a fresh workspace afterwards.
  const again = await new Agent().post('/api/auth/register', {
    email: owner.me.user.email,
    password: 'correct-horse-9',
    name: 'Back',
    businessName: `Again ${uniq()}`,
  })
  expectStatus(again, 201)
})
