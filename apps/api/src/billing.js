import { randomUUID } from 'node:crypto'
import { createCommerceClient, paymentEvent } from './commerce.js'
import { HttpError } from './http.js'
export const PRICES = Object.freeze({ monthly: 6900, yearly: 69000 })
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export function createBilling({ db, config, fetcher = fetch, commerce = createCommerceClient() }) {
  const key = config.moyasarSecretKey || ''
  const ready = config.production ? key.startsWith('sk_live_') : /^sk_(live|test)_/.test(key)
  async function request(path, body) {
    if (!ready) throw new HttpError(503, 'billing_unavailable')
    let res
    try {
      res = await fetcher(`https://api.moyasar.com/v1/${path}`, {
        method: body ? 'POST' : 'GET',
        headers: { authorization: `Basic ${Buffer.from(`${key}:`).toString('base64')}`, 'content-type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(15000),
      })
    } catch {
      throw new HttpError(502, 'billing_provider_error')
    }
    if (!res.ok) throw new HttpError(502, 'billing_provider_error')
    try {
      return await res.json()
    } catch {
      throw new HttpError(502, 'billing_provider_error')
    }
  }
  function couponCode(value) {
    if (typeof value !== 'string' || value.length > 40) throw new HttpError(400, 'coupon_invalid')
    const code = value.trim().toUpperCase()
    if (code && !/^[A-Z0-9_-]{3,40}$/.test(code)) throw new HttpError(400, 'coupon_invalid')
    return code
  }
  async function quote(tenantId, cycle, coupon, orderRef, referral = '') {
    if (!Object.hasOwn(PRICES, cycle)) throw new HttpError(400, 'validation_failed')
    return commerce.quote({ orderRef, accountRef: tenantId, plan: 'loyalty', cycle, currency: 'SAR', subtotalMinor: PRICES[cycle], coupon, referral })
  }
  async function preview(tenantId, cycle, value) {
    const coupon = couponCode(value)
    if (!coupon) throw new HttpError(400, 'coupon_invalid')
    const q = await quote(tenantId, cycle, coupon, randomUUID())
    return { subtotalMinor: q.subtotalMinor, discountMinor: q.discountMinor, amountMinor: q.amountMinor, currency: 'SAR' }
  }
  async function checkout(tenantId, cycle, requestKey, value = '', referralValue = '') {
    const coupon = couponCode(value)
    const referral = /^[a-f0-9]{32}$/.test(referralValue) ? referralValue : ''
    if (!Object.hasOwn(PRICES, cycle)) throw new HttpError(400, 'validation_failed')
    if (!ready) throw new HttpError(503, 'billing_unavailable')
    // Serialize creation for this tenant, including retries with the same key.
    return db.tx(async (tx) => {
      await tx.query('SELECT id FROM tenants WHERE id=$1 FOR UPDATE', [tenantId])
      let row = (await tx.query('SELECT * FROM subscription_checkouts WHERE tenant_id=$1 AND request_key=$2', [tenantId, requestKey])).rows[0]
      if (row && (row.cycle !== cycle || row.coupon_code !== coupon || (row.commerce_quote?.referral || '') !== referral))
        throw new HttpError(409, 'billing_request_conflict')
      if (row?.checkout_url) return row
      // Reuse an unpaid invoice to avoid duplicate invoices on rapid clicks.
      if (!row)
        row = (
          await tx.query(
            "SELECT * FROM subscription_checkouts WHERE tenant_id=$1 AND cycle=$2 AND coupon_code=$3 AND COALESCE(commerce_quote->>'referral','')=$4 AND (commerce_quote IS NULL OR (commerce_quote->>'expiresAt')::numeric > extract(epoch from now())*1000) AND status='pending' AND created_at > now() - interval '23 hours' ORDER BY created_at DESC LIMIT 1",
            [tenantId, cycle, coupon, referral],
          )
        ).rows[0]
      if (row?.checkout_url) return row
      const id = randomUUID()
      const q = coupon || referral ? await quote(tenantId, cycle, coupon, id, referral) : null
      row = (
        await tx.query(
          'INSERT INTO subscription_checkouts(id,tenant_id,request_key,cycle,amount,coupon_code,commerce_quote,commerce_state) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',
          [id, tenantId, requestKey, cycle, q?.amountMinor ?? PRICES[cycle], coupon, q ? JSON.stringify(q) : null, q ? 'awaiting_payment' : 'none'],
        )
      ).rows[0]
      const invoice = await request('invoices', {
        amount: row.amount,
        currency: 'SAR',
        description: `Mirqam Loyalty ${cycle} subscription (VAT included)`,
        success_url: `${config.publicUrl}/app/billing?checkout=${row.id}`,
        back_url: `${config.publicUrl}/app/billing`,
        callback_url: `${config.publicUrl}/api/billing/moyasar/webhook`,
        expired_at: new Date(row.commerce_quote?.expiresAt || Date.now() + 86400000).toISOString(),
        metadata: { checkout_id: row.id, tenant_id: tenantId, product: 'mirqam-loyalty' },
      })
      let url
      try {
        url = new URL(invoice.url)
      } catch {
        throw new HttpError(502, 'billing_provider_error')
      }
      if (
        url.protocol !== 'https:' ||
        url.hostname !== 'checkout.moyasar.com' ||
        !uuid.test(invoice.id) ||
        invoice.amount !== row.amount ||
        invoice.currency !== 'SAR'
      )
        throw new HttpError(502, 'billing_provider_error')
      return (
        await tx.query('UPDATE subscription_checkouts SET invoice_id=$1,checkout_url=$2 WHERE id=$3 AND tenant_id=$4 RETURNING *', [
          invoice.id,
          url.href,
          row.id,
          tenantId,
        ])
      ).rows[0]
    })
  }
  async function confirm(tenantId, checkoutId) {
    if (!uuid.test(checkoutId)) throw new HttpError(400, 'validation_failed')
    const row = (await db.query('SELECT * FROM subscription_checkouts WHERE tenant_id=$1 AND id=$2', [tenantId, checkoutId])).rows[0]
    if (!row) throw new HttpError(404, 'not_found')
    if (row.status === 'paid') return row
    const invoice = await request(`invoices/${encodeURIComponent(row.invoice_id)}`)
    if (invoice.id !== row.invoice_id || invoice.amount !== row.amount || invoice.currency !== 'SAR') throw new HttpError(409, 'billing_payment_mismatch')
    const payment = invoice.payments?.find(
      (p) => p.status === 'paid' && p.invoice_id === row.invoice_id && p.amount === row.amount && p.currency === 'SAR' && !p.refunded,
    )
    if (!payment) return row
    return db.tx(async (tx) => {
      await tx.query('SELECT id FROM tenants WHERE id=$1 FOR UPDATE', [tenantId])
      const locked = (await tx.query('SELECT * FROM subscription_checkouts WHERE tenant_id=$1 AND id=$2 FOR UPDATE', [tenantId, checkoutId])).rows[0]
      if (locked.status === 'paid') return locked
      await tx.query(
        `INSERT INTO subscriptions(tenant_id,cycle,expires_at) VALUES($1,$2,now()+make_interval(months=>$3))
        ON CONFLICT(tenant_id) DO UPDATE SET cycle=EXCLUDED.cycle, expires_at=GREATEST(subscriptions.expires_at,now())+make_interval(months=>$3),updated_at=now()`,
        [tenantId, row.cycle, row.cycle === 'yearly' ? 12 : 1],
      )
      if (row.commerce_quote) {
        const event = paymentEvent(row, payment, key.startsWith('sk_live_'))
        await tx.query('UPDATE subscription_checkouts SET commerce_event=$1,commerce_state=$2,commerce_next_at=now() WHERE id=$3 AND tenant_id=$4', [
          event ? JSON.stringify(event) : null,
          event ? 'pending' : 'review',
          checkoutId,
          tenantId,
        ])
      }
      return (
        await tx.query("UPDATE subscription_checkouts SET status='paid',payment_id=$1,paid_at=now() WHERE id=$2 AND tenant_id=$3 RETURNING *", [
          payment.id,
          checkoutId,
          tenantId,
        ])
      ).rows[0]
    })
  }
  async function reconcileCommerce() {
    if (!commerce.enabled) return
    const awaiting = (
      await db.query(
        "SELECT id,tenant_id FROM subscription_checkouts WHERE commerce_state='awaiting_payment' AND commerce_next_at<=now() AND created_at>now()-interval '2 days' ORDER BY commerce_next_at LIMIT 10",
      )
    ).rows
    for (const row of awaiting) {
      await db.query("UPDATE subscription_checkouts SET commerce_next_at=now()+interval '5 minutes' WHERE id=$1 AND tenant_id=$2", [row.id, row.tenant_id])
      try {
        await confirm(row.tenant_id, row.id)
      } catch {
        /* Provider failure is retried without changing a subscription. */
      }
    }
    const pending = (
      await db.query(
        "SELECT id,tenant_id,commerce_event FROM subscription_checkouts WHERE commerce_state='pending' AND commerce_next_at<=now() ORDER BY commerce_next_at LIMIT 20",
      )
    ).rows
    for (const row of pending) {
      await db.query(
        "UPDATE subscription_checkouts SET commerce_attempts=commerce_attempts+1,commerce_next_at=now()+interval '5 minutes' WHERE id=$1 AND tenant_id=$2",
        [row.id, row.tenant_id],
      )
      try {
        await commerce.confirm(row.commerce_event)
        await db.query("UPDATE subscription_checkouts SET commerce_state='delivered' WHERE id=$1 AND tenant_id=$2 AND commerce_state='pending'", [
          row.id,
          row.tenant_id,
        ])
      } catch {
        /* Durable outbox retries the same payment identity. */
      }
    }
  }
  return {
    commerceEnabled: commerce.enabled,
    preview,
    reconcileCommerce,
    ready,
    checkout,
    confirm,
    async status(tenantId) {
      return {
        ready,
        commerceEnabled: commerce.enabled,
        prices: PRICES,
        currency: 'SAR',
        vatIncluded: true,
        subscription: (await db.query('SELECT cycle,expires_at,expires_at>now() AS active FROM subscriptions WHERE tenant_id=$1', [tenantId])).rows[0] || null,
      }
    },
    async webhook(body) {
      const invoiceId = body?.type ? body?.data?.invoice_id : body?.id
      if (typeof invoiceId !== 'string' || !uuid.test(invoiceId)) return
      const row = (await db.query('SELECT id,tenant_id FROM subscription_checkouts WHERE invoice_id=$1', [invoiceId])).rows[0]
      if (row) await confirm(row.tenant_id, row.id)
    },
  }
}
