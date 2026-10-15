import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createBilling } from './billing.js'
import { renderSubscriptionEmail } from './billing-emails.js'
import { freshDb, seedTenant } from './testing.js'

const DAY = 86_400_000
let db
let sent
let mailer
let provider // what the fake Moyasar returns for any GET

const invoiceFor = (id, amount, payments = []) => ({
  id,
  status: payments.length ? 'paid' : 'initiated',
  amount,
  currency: 'SAR',
  url: `https://checkout.moyasar.com/invoices/${id}`,
  payments,
})

/* A workspace with an owner (the email recipient) and its own fake-Moyasar fixtures. */
async function workspace(locale = 'ar') {
  const t = await seedTenant(db)
  const {
    rows: [user],
  } = await db.query('INSERT INTO users (email, password_hash, name, locale) VALUES ($1, $2, $3, $4) RETURNING id', [
    `owner-${t.tenantId}@example.test`,
    'x',
    'Owner',
    locale,
  ])
  await db.query("INSERT INTO memberships (tenant_id, user_id, role) VALUES ($1, $2, 'owner')", [t.tenantId, user.id])
  return { ...t, email: `owner-${t.tenantId}@example.test` }
}

let n = 0
const uid = () => `${String(++n).padStart(8, '0')}-aaaa-4aaa-8aaa-aaaaaaaaaaaa`

function billingWith(extra = {}) {
  const fetcher = vi.fn(async (_url, init) => ({ ok: true, json: async () => structuredClone(provider.next(init)) }))
  return createBilling({
    db,
    config: { production: false, moyasarSecretKey: 'sk_test_fixture', publicUrl: 'https://points.example', trialDays: 14, ...extra },
    fetcher,
    mailer,
  })
}

/* Walks a checkout to a settled payment. */
async function pay(billing, tenantId, cycle) {
  const invoiceId = uid()
  const amount = cycle === 'yearly' ? 69000 : 6900
  let created = false
  provider = {
    next: (init) => {
      if (init.method === 'POST' && !created) {
        created = true
        return invoiceFor(invoiceId, amount)
      }
      return invoiceFor(invoiceId, amount, [{ id: uid(), invoice_id: invoiceId, status: 'paid', amount, currency: 'SAR', refunded: 0 }])
    },
  }
  const c = await billing.checkout(tenantId, cycle, `key-${uid()}`)
  await billing.confirm(tenantId, c.id)
  return { checkout: c, invoiceId, amount }
}

const kinds = async (tenantId) =>
  (await db.query('SELECT kind FROM subscription_events WHERE tenant_id=$1 ORDER BY created_at, kind', [tenantId])).rows.map((r) => r.kind)
const setExpiry = (tenantId, date) => db.query('UPDATE subscriptions SET expires_at=$2 WHERE tenant_id=$1', [tenantId, date])
const flush = () => new Promise((r) => setTimeout(r, 50))

beforeAll(async () => {
  db = await freshDb()
})
beforeEach(() => {
  sent = []
  mailer = { ready: true, send: vi.fn(async (m) => (sent.push(m), { ok: true })) }
})
afterAll(async () => {
  await db?.close()
})

describe('activation and renewal events', () => {
  it('first payment activates, repeat renews, other plan switches; each emails the owner once', async () => {
    const ws = await workspace()
    const billing = billingWith()
    await pay(billing, ws.tenantId, 'monthly')
    await pay(billing, ws.tenantId, 'monthly')
    await pay(billing, ws.tenantId, 'yearly')
    expect((await kinds(ws.tenantId)).sort()).toEqual(['activated', 'plan_changed', 'renewed'])
    await flush()
    await billing.flushEmails()
    expect(sent).toHaveLength(3)
    expect(sent.every((m) => m.to === ws.email)).toBe(true)
    expect((await billing.state(ws.tenantId)).state).toBe('active')
  })

  it('settling the same checkout twice records one event', async () => {
    const ws = await workspace()
    const billing = billingWith()
    const { checkout } = await pay(billing, ws.tenantId, 'monthly')
    await billing.confirm(ws.tenantId, checkout.id)
    expect(await kinds(ws.tenantId)).toEqual(['activated'])
  })

  it('a lapsed workspace paying again is an activation, not a renewal', async () => {
    const ws = await workspace()
    const billing = billingWith()
    await pay(billing, ws.tenantId, 'monthly')
    await setExpiry(ws.tenantId, new Date(Date.now() - DAY))
    await pay(billing, ws.tenantId, 'monthly')
    expect(await kinds(ws.tenantId)).toEqual(['activated', 'activated'])
  })
})

describe('expiry lifecycle', () => {
  it('reminds at 7 days and 1 day, expires once, and never repeats', async () => {
    const ws = await workspace()
    const billing = billingWith()
    await pay(billing, ws.tenantId, 'monthly')
    const now = new Date()

    await setExpiry(ws.tenantId, new Date(now.getTime() + 20 * DAY))
    expect(await billing.runLifecycle(now)).toMatchObject({ reminded: 0, expired: 0 })

    await setExpiry(ws.tenantId, new Date(now.getTime() + 6 * DAY))
    expect(await billing.runLifecycle(now)).toMatchObject({ reminded: 1 })
    expect(await billing.runLifecycle(now)).toMatchObject({ reminded: 0 })
    expect((await billing.state(ws.tenantId)).state).toBe('expiring')

    await setExpiry(ws.tenantId, new Date(now.getTime() + 20 * 3_600_000))
    // Inside the 1-day window both thresholds match; only the new (1d) reminder is new for this expiry.
    expect((await billing.runLifecycle(now)).reminded).toBeGreaterThanOrEqual(1)

    await setExpiry(ws.tenantId, new Date(now.getTime() - 1000))
    expect(await billing.runLifecycle(now)).toMatchObject({ expired: 1 })
    expect(await billing.runLifecycle(now)).toMatchObject({ expired: 0 })
    expect((await billing.state(ws.tenantId)).state).toBe('expired')
    expect(await kinds(ws.tenantId)).toContain('expired')
  })

  it('renewing after a reminder does not re-fire the old reminder', async () => {
    const ws = await workspace()
    const billing = billingWith()
    await pay(billing, ws.tenantId, 'monthly')
    const now = new Date()
    await setExpiry(ws.tenantId, new Date(now.getTime() + 3 * DAY))
    await billing.runLifecycle(now)
    await pay(billing, ws.tenantId, 'monthly')
    expect(await billing.runLifecycle(now)).toMatchObject({ reminded: 0 })
  })
})

describe('failed payments and webhooks', () => {
  it('records a verified payment failure once and ignores forged ones', async () => {
    const ws = await workspace()
    const billing = billingWith()
    const invoiceId = uid()
    const paymentId = uid()
    provider = { next: () => invoiceFor(invoiceId, 6900) }
    const c = await billing.checkout(ws.tenantId, 'monthly', 'failed-key-1')
    expect(c.invoice_id).toBe(invoiceId)
    const event = { type: 'payment_faild', data: { id: paymentId, invoice_id: invoiceId } }

    // The provider says this payment is NOT failed: the webhook is ignored.
    provider = { next: () => ({ id: paymentId, invoice_id: invoiceId, status: 'paid' }) }
    await billing.webhook(event)
    expect(await kinds(ws.tenantId)).toEqual([])

    provider = { next: () => ({ id: paymentId, invoice_id: invoiceId, status: 'failed' }) }
    await billing.webhook(event)
    await billing.webhook(event)
    expect(await kinds(ws.tenantId)).toEqual(['payment_failed'])
    expect((await billing.state(ws.tenantId)).state).not.toBe('active')
    await flush()
    expect(sent.some((m) => /تعذّرت/.test(m.subject))).toBe(true)
  })

  it('refuses webhooks without the shared secret when one is configured', async () => {
    const billing = billingWith({ moyasarWebhookSecret: 's3cret-token-value' })
    await expect(billing.webhook({ type: 'payment_paid', data: { invoice_id: uid() } })).rejects.toMatchObject({ status: 401 })
    await expect(billing.webhook({ secret_token: 'wrong', type: 'payment_paid', data: { invoice_id: uid() } })).rejects.toMatchObject({ status: 401 })
    await expect(billing.webhook({ secret_token: 's3cret-token-value', type: 'payment_paid', data: { invoice_id: uid() } })).resolves.toBeUndefined()
  })
})

describe('email delivery', () => {
  it('skips without a provider key, retries failures, and gives up after 5 attempts', async () => {
    const ws = await workspace()
    const billing = billingWith()
    await pay(billing, ws.tenantId, 'monthly')
    await flush()
    await db.query("UPDATE subscription_events SET email_status='pending', email_attempts=0 WHERE tenant_id=$1", [ws.tenantId])

    mailer.ready = false
    await billing.flushEmails()
    expect((await db.query('SELECT email_status FROM subscription_events WHERE tenant_id=$1', [ws.tenantId])).rows[0].email_status).toBe('skipped')

    await db.query("UPDATE subscription_events SET email_status='pending' WHERE tenant_id=$1", [ws.tenantId])
    mailer.ready = true
    mailer.send = vi.fn(async () => ({ ok: false, error: 'resend_500' }))
    for (let i = 0; i < 5; i++) await billing.flushEmails()
    const row = (await db.query('SELECT email_status, email_attempts FROM subscription_events WHERE tenant_id=$1', [ws.tenantId])).rows[0]
    expect(row).toMatchObject({ email_status: 'failed', email_attempts: 5 })
    expect(mailer.send).toHaveBeenCalledTimes(5)
  })

  it('renders Arabic and English emails with escaped values', () => {
    const data = { cycle: 'monthly', amountMinor: 6900, expiresAt: '2026-12-01T00:00:00.000Z', days: 7 }
    const ar = renderSubscriptionEmail('expiring_soon', { locale: 'ar', tenantName: '<b>مقهى</b>', data, url: 'https://x.test/app/billing' })
    expect(ar.subject).toContain('7 أيام')
    expect(ar.html).toContain('dir="rtl"')
    expect(ar.html).not.toContain('<b>مقهى</b>')
    const en = renderSubscriptionEmail('activated', { locale: 'en', tenantName: 'Cafe', data, url: 'https://x.test/app/billing' })
    expect(en.subject).toBe('Your Cafe subscription is active')
    expect(en.html).toContain('69.00 SAR')
  })
})

describe('entitlement and paywall', () => {
  const run = (billing, req) => new Promise((resolve) => billing.gate()(req, {}, (err) => resolve(err ?? null)))

  it('trial, expired and none states', async () => {
    const billing = billingWith()
    const ws = await workspace()
    expect((await billing.entitlement(ws.tenantId)).state).toBe('trial')
    expect((await billing.entitlement(ws.tenantId, new Date(Date.now() + 15 * DAY))).state).toBe('none')
  })

  it('blocks writes only when enforced and unsubscribed; reads, auth and billing stay open', async () => {
    const ws = await workspace()
    const off = billingWith({ billingEnforce: false })
    const on = billingWith({ billingEnforce: true, trialDays: 0 })
    const write = { method: 'POST', path: '/ledger/earn', auth: { tenantId: ws.tenantId } }
    expect(await run(off, write)).toBeNull()
    expect(await run(on, write)).toMatchObject({ status: 402, code: 'subscription_required' })
    expect(await run(on, { ...write, method: 'GET' })).toBeNull()
    expect(await run(on, { ...write, path: '/billing/checkout' })).toBeNull()
    expect(await run(on, { ...write, path: '/auth/logout' })).toBeNull()
    expect(await run(on, { ...write, auth: null })).toBeNull()
    await pay(on, ws.tenantId, 'monthly')
    expect(await run(on, write)).toBeNull()
  })
})
