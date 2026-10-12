import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createBilling } from './billing.js'
import { freshDb, seedTenant } from './testing.js'

let db, a, b, service, invoice, fetcher
const invoiceId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
beforeAll(async () => {
  db = await freshDb()
  a = await seedTenant(db)
  b = await seedTenant(db)
  invoice = { id: invoiceId, status: 'initiated', amount: 6900, currency: 'SAR', url: `https://checkout.moyasar.com/invoices/${invoiceId}`, payments: [] }
  fetcher = vi.fn(async () => ({ ok: true, json: async () => structuredClone(invoice) }))
  service = createBilling({ db, config: { production: false, moyasarSecretKey: 'sk_test_fixture', publicUrl: 'http://localhost:5174' }, fetcher })
})
afterAll(async () => {
  await db?.close()
})
describe('subscription settlement', () => {
  it('fails closed for test keys in production', () =>
    expect(createBilling({ db, config: { production: true, moyasarSecretKey: 'sk_test_fixture' }, fetcher }).ready).toBe(false))
  it('creates priced checkout and reuses retries without activating', async () => {
    const c = await service.checkout(a.tenantId, 'monthly', 'request-123')
    expect(c.amount).toBe(6900)
    expect((await service.checkout(a.tenantId, 'monthly', 'request-123')).id).toBe(c.id)
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect((await service.status(a.tenantId)).subscription).toBeNull()
    await expect(service.confirm(b.tenantId, c.id)).rejects.toMatchObject({ status: 404 })
    await service.webhook({ id: invoiceId, status: 'paid' })
    expect((await service.status(a.tenantId)).subscription).toBeNull()
  })
  it('rejects mismatched amount then settles concurrent callbacks only once', async () => {
    const c = await service.checkout(a.tenantId, 'monthly', 'request-123')
    invoice.amount = 1
    await expect(service.confirm(a.tenantId, c.id)).rejects.toMatchObject({ status: 409 })
    invoice.amount = 6900
    invoice.payments = [{ id: 'pay1', invoice_id: invoiceId, status: 'paid', amount: 6900, currency: 'SAR', refunded: 0 }]
    await Promise.all([service.confirm(a.tenantId, c.id), service.webhook({ id: invoiceId })])
    const first = (await service.status(a.tenantId)).subscription
    expect(first.active).toBe(true)
    await service.webhook({ type: 'payment_paid', data: { invoice_id: invoiceId } })
    expect((await service.status(a.tenantId)).subscription.expires_at).toEqual(first.expires_at)
  })
  it('blocks invalid cycles', async () => {
    await expect(service.checkout(a.tenantId, 'toString', 'request-x')).rejects.toMatchObject({ status: 400 })
  })
})
