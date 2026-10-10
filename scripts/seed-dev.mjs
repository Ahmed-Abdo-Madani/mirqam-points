#!/usr/bin/env node
/* Seeds a local demo workspace through the public API (never touches the DB
   directly, so it exercises the same validation as the UI).
   Usage: npm run dev:api, then `node scripts/seed-dev.mjs [--base http://localhost:4100]`.
   Re-runnable: registers the demo owner, or logs in if it already exists.
   LOCAL DEVELOPMENT ONLY — these credentials must never exist in production. */
import { randomUUID } from 'node:crypto'

import { DEMO } from './demo-account.mjs'

export { DEMO }

const argBase = process.argv.indexOf('--base')
const BASE = (argBase > -1 ? process.argv[argBase + 1] : process.env.BASE || 'http://localhost:4100').replace(/\/$/, '')
if (!/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(BASE)) {
  console.error(`Refusing to seed non-local host: ${BASE}`)
  process.exit(1)
}

let cookie = ''
async function call(method, path, body, headers = {}) {
  const res = await fetch(`${BASE}/api${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}), ...headers },
    body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
  })
  const set = res.headers.get('set-cookie')
  if (set) cookie = set.split(';')[0]
  const data = await res.json().catch(() => null)
  return { status: res.status, data }
}

const reg = await call('POST', '/auth/register', DEMO.owner)
if (reg.status === 409) {
  const login = await call('POST', '/auth/login', { email: DEMO.owner.email, password: DEMO.owner.password })
  if (login.status !== 200) throw new Error(`login failed: ${JSON.stringify(login.data)}`)
  console.log('Demo owner exists — logged in.')
} else if (reg.status !== 201) {
  throw new Error(`register failed: ${JSON.stringify(reg.data)}`)
} else {
  console.log('Registered demo owner.')
}

const staff = await call('POST', '/staff', { ...DEMO.cashier })
console.log(staff.status === 201 ? 'Added demo cashier.' : 'Demo cashier already present.')

const existing = (await call('GET', '/programs')).data.items
async function program(name, type, config) {
  const found = existing.find((p) => p.name === name)
  if (found) return found
  const created = await call('POST', '/programs', { name, type, config })
  await call('PATCH', `/programs/${created.data.id}`, { status: 'active' })
  return created.data
}
const coffee = await program('بطاقة القهوة', 'stamps', { stampsPerVisit: 1, stampsRequired: 8, minPurchaseMinor: 1200 })
const points = await program('نقاط السحاب', 'points', { pointsPerUnit: 1, unitMinor: 100, minPurchaseMinor: 0 })

const people = [
  ['0501112233', 'نورة العتيبي', true],
  ['0552223344', 'عبدالله الشمري', false],
  ['0563334455', 'ريم الدوسري', true],
  ['0574445566', 'Khalid Al-Harbi', true],
  ['0585556677', null, false],
]
for (const [phone, name, consent] of people) {
  const res = await call('POST', '/members', { phone, ...(name ? { name } : {}), marketingConsent: consent })
  const memberId = res.status === 201 ? res.data.id : res.data.memberId
  if (res.status !== 201) continue // only post sample transactions for new members
  for (const amount of [1800, 4550, 2300]) {
    await call('POST', '/ledger/earn', { programId: coffee.id, memberId, purchaseMinor: amount }, { 'idempotency-key': randomUUID() })
    await call('POST', '/ledger/earn', { programId: points.id, memberId, purchaseMinor: amount * 3 }, { 'idempotency-key': randomUUID() })
  }
  await call('POST', '/ledger/redeem', { programId: points.id, memberId, points: 50 }, { 'idempotency-key': randomUUID() })
}
console.log(`Seeded. Sign in at the web app with ${DEMO.owner.email} (password in scripts/seed-dev.mjs).`)
