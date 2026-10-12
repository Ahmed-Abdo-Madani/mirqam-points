import { HttpError } from './http.js'
export const PRICES = Object.freeze({ monthly: 6900, yearly: 69000 })
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export function createBilling({ db, config, fetcher = fetch }) {
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
  async function checkout(tenantId, cycle, requestKey) {
    if (!Object.hasOwn(PRICES, cycle)) throw new HttpError(400, 'validation_failed')
    if (!ready) throw new HttpError(503, 'billing_unavailable')
    // Serialize creation for this tenant, including retries with the same key.
    return db.tx(async (tx) => {
      await tx.query('SELECT id FROM tenants WHERE id=$1 FOR UPDATE', [tenantId])
      let row = (await tx.query('SELECT * FROM subscription_checkouts WHERE tenant_id=$1 AND request_key=$2', [tenantId, requestKey])).rows[0]
      if (row && row.cycle !== cycle) throw new HttpError(409, 'billing_request_conflict')
      if (row?.checkout_url) return row
      // Reuse an unpaid invoice to avoid duplicate invoices on rapid clicks.
      if (!row)
        row = (
          await tx.query(
            "SELECT * FROM subscription_checkouts WHERE tenant_id=$1 AND cycle=$2 AND status='pending' AND created_at > now() - interval '23 hours' ORDER BY created_at DESC LIMIT 1",
            [tenantId, cycle],
          )
        ).rows[0]
      if (row?.checkout_url) return row
      row = (
        await tx.query('INSERT INTO subscription_checkouts(tenant_id,request_key,cycle,amount) VALUES($1,$2,$3,$4) RETURNING *', [
          tenantId,
          requestKey,
          cycle,
          PRICES[cycle],
        ])
      ).rows[0]
      const invoice = await request('invoices', {
        amount: row.amount,
        currency: 'SAR',
        description: `Mirqam Loyalty ${cycle} subscription (VAT included)`,
        success_url: `${config.publicUrl}/app/billing?checkout=${row.id}`,
        back_url: `${config.publicUrl}/app/billing`,
        callback_url: `${config.publicUrl}/api/billing/moyasar/webhook`,
        expired_at: new Date(Date.now() + 86400000).toISOString(),
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
      return (
        await tx.query("UPDATE subscription_checkouts SET status='paid',payment_id=$1,paid_at=now() WHERE id=$2 AND tenant_id=$3 RETURNING *", [
          payment.id,
          checkoutId,
          tenantId,
        ])
      ).rows[0]
    })
  }
  return {
    ready,
    checkout,
    confirm,
    async status(tenantId) {
      return {
        ready,
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
