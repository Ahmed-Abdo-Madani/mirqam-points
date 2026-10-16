#!/usr/bin/env node
/* Creates the App Store review (demo) workspace on a deployed server and prints its credentials.
   Run it yourself — it makes a real account:
     node scripts/seed-review-account.mjs --base https://loyalty.mirqam.sa [--email app.review@mirqam.sa]
   The password is random and printed once; paste it into App Store Connect → App Review → Sign-in
   information. Safe to re-run: if the account exists it is left alone (the password cannot be recovered). */
import { randomBytes, randomUUID } from 'node:crypto'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const BASE = (arg('--base') || '').replace(/\/$/, '')
if (!/^https:\/\/[^/]+$/.test(BASE)) {
  console.error('Pass the deployed origin: --base https://loyalty.mirqam.sa')
  process.exit(1)
}
const email = arg('--email') || 'app.review@mirqam.sa'
const password = randomBytes(12).toString('base64url')

let cookie = ''
async function call(method, path, body, headers = {}) {
  const res = await fetch(`${BASE}/api${path}`, {
    method,
    headers: { 'content-type': 'application/json', origin: BASE, ...(cookie ? { cookie } : {}), ...headers },
    body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
  })
  const set = res.headers.get('set-cookie')
  if (set) cookie = set.split(';')[0]
  return { status: res.status, data: await res.json().catch(() => null) }
}

const reg = await call('POST', '/auth/register', { email, password, name: 'App Review', businessName: 'Mirqam Demo Cafe', locale: 'ar' })
if (reg.status === 409) {
  console.error(`${email} already exists, so no new password was created. Use the existing credentials, or re-run with --email <another address>.`)
  process.exit(2)
}
if (reg.status !== 201) {
  console.error(`Registration failed (${reg.status}): ${JSON.stringify(reg.data)}`)
  process.exit(1)
}

async function program(name, type, config) {
  const created = await call('POST', '/programs', { name, type, config })
  await call('PATCH', `/programs/${created.data.id}`, { status: 'active' })
  return created.data
}
const stamps = await program('بطاقة الأختام', 'stamps', { stampsPerVisit: 1, stampsRequired: 8 })
const points = await program('نقاط الولاء', 'points', { pointsPerUnit: 1, unitMinor: 100, minPurchaseMinor: 0 })

const people = [
  ['0501112233', 'نورة العتيبي'],
  ['0552223344', 'عبدالله الشمري'],
  ['0563334455', 'ريم الدوسري'],
]
for (const [phone, name] of people) {
  const res = await call('POST', '/members', { phone, name, marketingConsent: true })
  if (res.status !== 201) continue
  for (const amount of [1800, 4550, 2300]) {
    await call('POST', '/ledger/earn', { programId: points.id, memberId: res.data.id, purchaseMinor: amount }, { 'idempotency-key': randomUUID() })
  }
  await call('POST', '/ledger/earn', { programId: stamps.id, memberId: res.data.id }, { 'idempotency-key': randomUUID() })
}

console.log(`
Review account created on ${BASE}
  Username: ${email}
  Password: ${password}

Save the password now; it is not stored anywhere else.
Sample customer for the review notes: mobile 0501112233 (try the Cashier tab).
`)
