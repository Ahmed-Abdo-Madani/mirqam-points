import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { createBilling } from './billing.js'
import { createCommerceClient, paymentEvent } from './commerce.js'
import { freshDb, seedTenant } from './testing.js'

let db, a, b, service, invoice, fetcher, commerce
beforeAll(async () => {
  db = await freshDb()
  a = await seedTenant(db)
  b = await seedTenant(db)
  commerce = {
    enabled: true,
    quote: vi.fn(async (body) => {
      if (body.coupon !== 'STAFF10' && !(body.coupon === '' && /^[a-f0-9]{32}$/.test(body.referral)))
        throw Object.assign(new Error('coupon_invalid'), { status: 400 })
      return {
        ...body,
        id: 'a'.repeat(64),
        platform: 'loyalty',
        discountMinor: body.coupon ? Math.round(body.subtotalMinor / 10) : 0,
        amountMinor: body.subtotalMinor - (body.coupon ? Math.round(body.subtotalMinor / 10) : 0),
        expiresAt: Date.now() + 86400000,
      }
    }),
    confirm: vi.fn(async () => ({ ok: true })),
  }
  fetcher = vi.fn(async (_url, options) => {
    if (options.method === 'POST') {
      const body = JSON.parse(options.body)
      const id = randomUUID()
      invoice = { id, amount: body.amount, currency: 'SAR', url: 'https://checkout.moyasar.com/invoices/' + id, payments: [] }
    }
    return { ok: true, json: async () => structuredClone(invoice) }
  })
  service = createBilling({ db, config: { production: true, moyasarSecretKey: 'sk_live_fixture', publicUrl: 'https://example.invalid' }, fetcher, commerce })
})
afterAll(async () => {
  await db?.close()
})
it('rejects invalid coupon before issuing an invoice', async () => {
  await expect(service.checkout(a.tenantId, 'monthly', 'invalid-coupon', 'INVALID')).rejects.toMatchObject({ status: 400 })
  expect(fetcher).not.toHaveBeenCalled()
})
it('discounts exact invoice, isolates tenants, queues verified payment once and retries delivery', async () => {
  const row = await service.checkout(a.tenantId, 'monthly', 'staff-order', 'STAFF10')
  expect(row.amount).toBe(6210)
  expect(row.commerce_state).toBe('awaiting_payment')
  expect((await service.checkout(a.tenantId, 'monthly', 'staff-order', 'STAFF10')).id).toBe(row.id)
  await expect(service.checkout(a.tenantId, 'monthly', 'staff-order', 'OTHER')).rejects.toMatchObject({ status: 409 })
  await expect(service.confirm(b.tenantId, row.id)).rejects.toMatchObject({ status: 404 })
  await service.confirm(a.tenantId, row.id)
  expect(commerce.confirm).not.toHaveBeenCalled()
  invoice.payments = [
    { id: randomUUID(), invoice_id: invoice.id, status: 'paid', amount: 6210, currency: 'SAR', refunded: 0, updated_at: new Date().toISOString() },
  ]
  await service.confirm(a.tenantId, row.id)
  let saved = (await db.query('SELECT * FROM subscription_checkouts WHERE id=$1', [row.id])).rows[0]
  expect(saved.commerce_state).toBe('pending')
  expect(saved.commerce_event.amountMinor).toBe(6210)
  const expires = (await service.status(a.tenantId)).subscription.expires_at
  commerce.confirm.mockRejectedValueOnce(new Error('offline'))
  await service.reconcileCommerce()
  saved = (await db.query('SELECT * FROM subscription_checkouts WHERE id=$1', [row.id])).rows[0]
  expect(saved.commerce_state).toBe('pending')
  await db.query('UPDATE subscription_checkouts SET commerce_next_at=now() WHERE id=$1', [row.id])
  await service.reconcileCommerce()
  await service.confirm(a.tenantId, row.id)
  await service.reconcileCommerce()
  expect(commerce.confirm).toHaveBeenCalledTimes(2)
  expect((await service.status(a.tenantId)).subscription.expires_at).toEqual(expires)
  saved = (await db.query('SELECT * FROM subscription_checkouts WHERE id=$1', [row.id])).rows[0]
  expect(saved.commerce_state).toBe('delivered')
})
it('does not report test or unprovable payments as real sales', () => {
  const row = { commerce_quote: { id: 'a'.repeat(64) }, id: 'order', tenant_id: 'tenant', amount: 6210 }
  expect(paymentEvent(row, { id: 'pay', updated_at: new Date().toISOString() }, false)).toBeNull()
  expect(paymentEvent(row, { id: 'pay', live: false, updated_at: new Date().toISOString() }, true)).toBeNull()
  expect(paymentEvent(row, { id: 'pay' }, true)).toBeNull()
})
it('central client fails closed on tampered prices and mismatched receipts', async () => {
  const q = { orderRef: 'o', accountRef: 'a', subtotalMinor: 6900 }
  const client = createCommerceClient({
    key: 'a'.repeat(64),
    fetcher: async () => ({
      ok: true,
      json: async () => ({
        quote: { ...q, id: 'a'.repeat(64), platform: 'loyalty', currency: 'SAR', discountMinor: 690, amountMinor: 6900, expiresAt: Date.now() + 10000 },
        receipt: { id: 'wrong' },
      }),
    }),
  })
  await expect(client.quote(q)).rejects.toMatchObject({ status: 502 })
  await expect(client.confirm({ quoteId: 'q', paymentRef: 'p' })).rejects.toMatchObject({ status: 502 })
})
it('attributes referral-only payment at full price without double delivery', async () => {
  const referral = 'c'.repeat(32),
    before = commerce.confirm.mock.calls.length
  const row = await service.checkout(b.tenantId, 'monthly', 'referral-order', '', referral)
  expect(row.amount).toBe(6900)
  expect(row.commerce_quote.referral).toBe(referral)
  expect((await service.checkout(b.tenantId, 'monthly', 'referral-order', '', referral)).id).toBe(row.id)
  await expect(service.checkout(b.tenantId, 'monthly', 'referral-order', '', 'd'.repeat(32))).rejects.toMatchObject({ status: 409 })
  invoice.payments = [
    { id: randomUUID(), invoice_id: invoice.id, status: 'paid', amount: 6900, currency: 'SAR', refunded: 0, updated_at: new Date().toISOString() },
  ]
  await service.confirm(b.tenantId, row.id)
  await service.reconcileCommerce()
  await service.confirm(b.tenantId, row.id)
  await service.reconcileCommerce()
  expect(commerce.confirm.mock.calls.length - before).toBe(1)
  expect((await db.query('SELECT commerce_state FROM subscription_checkouts WHERE id=$1', [row.id])).rows[0].commerce_state).toBe('delivered')
})
