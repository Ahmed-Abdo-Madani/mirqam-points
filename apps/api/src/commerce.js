import { HttpError } from './http.js'

const BASE = 'https://mirqam.sa/m/ad0ed94a6a279f02a1295ae283efa07d2c18/commerce/loyalty/'
export function createCommerceClient({ key = process.env.MIRQAM_COMMERCE_KEY || '', fetcher = fetch } = {}) {
  const enabled = /^[a-f0-9]{64}$/.test(key)
  async function call(action, body) {
    if (!enabled) throw new HttpError(503, 'billing_unavailable')
    let r, data
    try {
      r = await fetcher(BASE + action, {
        method: 'POST',
        redirect: 'error',
        headers: { authorization: 'Bearer ' + key, 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(5000),
      })
      data = await r.json()
    } catch {
      throw new HttpError(503, 'billing_unavailable')
    }
    if (!r.ok) throw new HttpError(r.status >= 500 ? 503 : 400, r.status >= 500 ? 'billing_unavailable' : 'coupon_invalid')
    return data
  }
  return {
    enabled,
    async quote(body) {
      const q = await call('quote', body)
      if (
        !/^[a-f0-9]{64}$/.test(q.id || '') ||
        q.platform !== 'loyalty' ||
        q.orderRef !== body.orderRef ||
        q.accountRef !== body.accountRef ||
        q.currency !== 'SAR' ||
        q.subtotalMinor !== body.subtotalMinor ||
        !Number.isSafeInteger(q.discountMinor) ||
        q.discountMinor < 0 ||
        q.amountMinor !== body.subtotalMinor - q.discountMinor ||
        q.amountMinor < 100 ||
        !Number.isFinite(q.expiresAt) ||
        q.expiresAt <= Date.now()
      )
        throw new HttpError(502, 'billing_payment_mismatch')
      return q
    },
    async confirm(event) {
      const receipt = await call('confirm', event)
      if (receipt.id !== event.quoteId || receipt.paymentRef !== event.paymentRef) throw new HttpError(502, 'billing_payment_mismatch')
      return receipt
    },
  }
}
export function paymentEvent(row, payment, live) {
  if (!row.commerce_quote) return null
  const paidAt = payment.captured_at || payment.updated_at
  if (!live || payment.live === false || payment.test === true || !/^[a-zA-Z0-9_.:-]{1,160}$/.test(payment.id || '') || !Number.isFinite(Date.parse(paidAt)))
    return null
  return {
    quoteId: row.commerce_quote.id,
    orderRef: row.id,
    accountRef: row.tenant_id,
    paymentRef: payment.id,
    status: 'paid',
    live: true,
    currency: 'SAR',
    amountMinor: row.amount,
    paidAt: new Date(paidAt).toISOString(),
  }
}
export function startCommerceWorker(billing) {
  if (!billing.commerceEnabled) return () => {}
  let busy = false
  const run = async () => {
    if (busy) return
    busy = true
    try {
      await billing.reconcileCommerce()
    } catch {
      console.error('commerce_reconcile_failed')
    } finally {
      busy = false
    }
  }
  const timer = setInterval(run, 60000)
  timer.unref()
  void run()
  return () => clearInterval(timer)
}
