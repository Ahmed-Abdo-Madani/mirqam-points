/* Subscription payment receipts: the pure view model (stamp, amounts from what was
   charged, deterministic number, Riyadh dates) and the owner-only routes against a
   real database (tenant isolation, roles, email). */
import express from 'express'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createSession, loadSession } from './auth.js'
import { createBilling, PRICES } from './billing.js'
import { errorHandler } from './http.js'
import { receiptAmounts, receiptNumber, receiptView, renderReceiptEmail, riyadhParts } from './receipts.js'
import billingRoutes from './routes/billing.js'
import { freshDb, seedTenant } from './testing.js'

const paidRow = (over = {}) => ({
  id: '8f2c19ab-1234-4abc-9def-0123456789ab',
  cycle: 'monthly',
  amount: 6900,
  currency: 'SAR',
  status: 'paid',
  paid_at: new Date('2026-11-25T22:30:00Z'),
  payment_id: 'pay-1',
  invoice_id: 'inv-1',
  coupon_code: '',
  commerce_quote: null,
  ...over,
})

describe('receipt view model', () => {
  it('stamps «paid» only for a settled payment', () => {
    const view = receiptView({ checkout: paidRow(), tenantName: 'Store' })
    expect(view.stamp).toEqual({ kind: 'paid' })
    expect(view.status).toBe('paid')
    expect(receiptView({ checkout: paidRow({ status: 'pending' }), tenantName: 'Store' })).toBe(null)
    expect(receiptView({ checkout: paidRow({ paid_at: null }), tenantName: 'Store' })).toBe(null)
    expect(receiptView({ checkout: null, tenantName: 'Store' })).toBe(null)
  })

  it('numbers deterministically from the row, on the Riyadh calendar day of the payment', () => {
    // 22:30 UTC on the 25th is 01:30 on the 26th in Riyadh.
    expect(riyadhParts('2026-11-25T22:30:00Z')).toEqual({ date: '2026-11-26', time: '01:30' })
    expect(receiptNumber(paidRow())).toBe('ML-R-20261126-8F2C19AB')
    expect(receiptView({ checkout: paidRow(), tenantName: 'x' }).number).toBe(receiptNumber(paidRow()))
    const view = receiptView({ checkout: paidRow(), tenantName: 'Store' })
    expect(view.paidAtRiyadh).toEqual({ date: '2026-11-26', time: '01:30' })
    expect(view.paidAt).toBe('2026-11-25T22:30:00.000Z')
  })

  it('uses the stored amount and quote, never the price list', () => {
    // A discounted checkout: subtotal 69.00 − 6.90 = 62.10 SAR charged.
    const coupon = paidRow({ amount: 6210, coupon_code: 'WELCOME10', commerce_quote: { subtotalMinor: 6900, discountMinor: 690, amountMinor: 6210 } })
    const view = receiptView({ checkout: coupon, tenantName: 'Store' })
    expect(view).toMatchObject({ subtotalMinor: 6900, discountMinor: 690, totalMinor: 6210, paidMinor: 6210, couponCode: 'WELCOME10' })
    expect(view.lines).toEqual([{ item: 'subscription', cycle: 'monthly', quantity: 1, amountMinor: 6900 }])
    expect(view.amountWords.ar).toBe('فقط اثنان وستون ريالًا سعوديًا وعشر هللات لا غير')
    expect(view.amountWords.en).toBe('Sixty-Two Saudi Riyals and Ten Halalas Only')
    // An amount that is not today's price stays what was charged.
    const old = receiptView({ checkout: paidRow({ cycle: 'yearly', amount: 59900 }), tenantName: 'Store' })
    expect(old).toMatchObject({ subtotalMinor: 59900, discountMinor: 0, totalMinor: 59900 })
    expect(old.totalMinor).not.toBe(PRICES.yearly)
    // A quote that does not add up to the stored amount is ignored, not trusted.
    expect(receiptAmounts(paidRow({ amount: 6900, commerce_quote: { subtotalMinor: 69000, discountMinor: 0 } }))).toEqual({
      subtotalMinor: 6900,
      discountMinor: 0,
      totalMinor: 6900,
    })
  })

  it('names Mirqam as issuer without a VAT number, and the workspace as the party', () => {
    const view = receiptView({ checkout: paidRow(), tenantName: 'مقهى السحاب', ownerEmail: 'o@example.test', coverageEndsAt: '2026-12-25T22:30:00Z' })
    expect(view.issuer.crNumber).toBe('7055011105')
    expect(view.issuer.legalName.ar).toBe('شركة مرقام التجارية')
    expect(JSON.stringify(view)).not.toMatch(/vat(Number|Minor)/i)
    expect(view.vatIncluded).toBe(true)
    expect(view.party).toEqual({ name: 'مقهى السحاب', email: 'o@example.test' })
    expect(view.coverageEndsRiyadh).toBe('2026-12-26')
    expect(receiptView({ checkout: paidRow(), tenantName: 'x', coverageEndsAt: 'nonsense' }).coverageEndsAt).toBe(null)
  })

  it('renders an escaped email with the link and the key facts', () => {
    const view = receiptView({ checkout: paidRow(), tenantName: '<b>Store</b>' })
    const ar = renderReceiptEmail(view, { locale: 'ar', url: 'https://loyalty.mirqam.sa/app/billing/receipts/x' })
    expect(ar.subject).toContain('ML-R-20261126-8F2C19AB')
    expect(ar.html).toContain('dir="rtl"')
    expect(ar.html).toContain('69.00 ر.س')
    expect(ar.html).toContain('href="https://loyalty.mirqam.sa/app/billing/receipts/x"')
    expect(ar.html).not.toContain('<b>Store</b>')
    const en = renderReceiptEmail(view, { locale: 'en', url: 'https://x.test/r' })
    expect(en.html).toContain('dir="ltr"')
    expect(en.html).toContain('SAR 69.00')
  })
})

describe('receipt routes', () => {
  let db, server, base, a, b
  const mailer = { ready: false, send: vi.fn(async () => ({ ok: true })) }

  async function workspace(name) {
    const t = await seedTenant(db)
    await db.query('UPDATE tenants SET name = $2 WHERE id = $1', [t.tenantId, name])
    const cookies = {}
    for (const role of ['owner', 'cashier']) {
      const {
        rows: [u],
      } = await db.query("INSERT INTO users (email, password_hash, name) VALUES ($1, 'not-a-login-hash', $2) RETURNING id", [
        `${role}-${t.tenantId.slice(0, 8)}@example.test`,
        role,
      ])
      await db.query('INSERT INTO memberships (tenant_id, user_id, role) VALUES ($1, $2, $3)', [t.tenantId, u.id, role])
      cookies[role] = `mp_session=${await createSession(db, { userId: u.id, tenantId: t.tenantId, ttlDays: 1 })}`
    }
    return { ...t, cookies, email: `owner-${t.tenantId.slice(0, 8)}@example.test` }
  }
  async function checkout(tenantId, { status = 'paid', amount = 6900, paidAt = '2026-11-20T09:00:00Z' } = {}) {
    const {
      rows: [row],
    } = await db.query(
      'INSERT INTO subscription_checkouts (tenant_id, request_key, cycle, amount, status, paid_at, invoice_id) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id',
      [tenantId, `rk-${Math.random()}`, 'monthly', amount, status, status === 'paid' ? paidAt : null, `inv-${Math.random()}`],
    )
    return row.id
  }
  const call = async (method, path, cookie, body) => {
    const res = await fetch(base + path, {
      method,
      headers: { ...(cookie ? { cookie } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    })
    return { status: res.status, body: await res.json() }
  }

  beforeAll(async () => {
    db = await freshDb()
    const app = express()
    app.use(express.json(), loadSession(db))
    app.use('/api/billing', billingRoutes(createBilling({ db, config: { publicUrl: 'https://loyalty.mirqam.sa' }, mailer }), { db }))
    app.use(errorHandler)
    server = await new Promise((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s))
    })
    base = `http://127.0.0.1:${server.address().port}`
    a = await workspace('مقهى السحاب')
    b = await workspace('Other store')
    a.first = await checkout(a.tenantId, { paidAt: '2026-10-20T09:00:00Z' })
    a.second = await checkout(a.tenantId, { amount: 69000, paidAt: '2026-11-20T09:00:00Z' })
    a.pending = await checkout(a.tenantId, { status: 'pending' })
    await db.query("INSERT INTO subscription_events (tenant_id, kind, ref, data) VALUES ($1, 'renewed', $2, $3)", [
      a.tenantId,
      a.second,
      JSON.stringify({ cycle: 'monthly', amountMinor: 69000, expiresAt: '2027-11-20T09:00:00.000Z' }),
    ])
  })
  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve))
    await db.close()
  })

  it('lists only this workspace’s settled payments, newest first', async () => {
    const list = await call('GET', '/api/billing/receipts', a.cookies.owner)
    expect(list.status).toBe(200)
    expect(list.body.total).toBe(2)
    expect(list.body.items.map((i) => i.id)).toEqual([a.second, a.first])
    expect(list.body.items[0]).toMatchObject({ amountMinor: 69000, currency: 'SAR', cycle: 'monthly', status: 'paid', paidAt: '2026-11-20T09:00:00.000Z' })
    expect(list.body.items[0].number).toBe(`ML-R-20261120-${a.second.slice(0, 8).toUpperCase()}`)
    expect((await call('GET', '/api/billing/receipts?limit=1&offset=1', a.cookies.owner)).body.items.map((i) => i.id)).toEqual([a.first])
    expect(await call('GET', '/api/billing/receipts', b.cookies.owner)).toEqual({ status: 200, body: { items: [], total: 0 } })
  })

  it('serves the owner’s receipt and 404s anything else', async () => {
    const one = await call('GET', `/api/billing/receipts/${a.second}`, a.cookies.owner)
    expect(one.status).toBe(200)
    expect(one.body).toMatchObject({
      id: a.second,
      stamp: { kind: 'paid' },
      totalMinor: 69000,
      party: { name: 'مقهى السحاب', email: a.email },
      coverageEndsRiyadh: '2027-11-20',
    })
    const notFound = { status: 404, body: { error: 'receipt_not_found' } }
    expect(await call('GET', `/api/billing/receipts/${a.second}`, b.cookies.owner)).toEqual(notFound)
    expect(await call('GET', `/api/billing/receipts/${a.pending}`, a.cookies.owner)).toEqual(notFound)
    expect(await call('GET', '/api/billing/receipts/not-a-uuid', a.cookies.owner)).toEqual(notFound)
  })

  it('is owner-only', async () => {
    expect((await call('GET', '/api/billing/receipts', a.cookies.cashier)).status).toBe(403)
    expect((await call('GET', `/api/billing/receipts/${a.first}`, a.cookies.cashier)).status).toBe(403)
    expect((await call('POST', `/api/billing/receipts/${a.first}/email`, a.cookies.cashier, {})).status).toBe(403)
    expect((await call('GET', '/api/billing/receipts')).status).toBe(401)
  })

  it('emails the signed-in owner a link, or answers 503 when mail is not configured', async () => {
    mailer.ready = false
    expect(await call('POST', `/api/billing/receipts/${a.first}/email`, a.cookies.owner, {})).toEqual({ status: 503, body: { error: 'email_unavailable' } })
    expect(mailer.send).not.toHaveBeenCalled()
    mailer.ready = true
    const sent = await call('POST', `/api/billing/receipts/${a.first}/email`, a.cookies.owner, { locale: 'en' })
    expect(sent).toEqual({ status: 200, body: { sent: true, to: a.email } })
    expect(mailer.send).toHaveBeenCalledTimes(1)
    const msg = mailer.send.mock.calls[0][0]
    expect(msg.to).toBe(a.email)
    expect(msg.html).toContain(`https://loyalty.mirqam.sa/app/billing/receipts/${a.first}`)
    expect(msg.html).toContain('dir="ltr"')
    expect(await call('POST', `/api/billing/receipts/${a.first}/email`, b.cookies.owner, {})).toEqual({ status: 404, body: { error: 'receipt_not_found' } })
    mailer.send.mockResolvedValueOnce({ ok: false, reason: 'resend_500' })
    expect(await call('POST', `/api/billing/receipts/${a.first}/email`, a.cookies.owner, {})).toEqual({ status: 502, body: { error: 'email_failed' } })
    expect(mailer.send).toHaveBeenCalledTimes(2)
  })
})
