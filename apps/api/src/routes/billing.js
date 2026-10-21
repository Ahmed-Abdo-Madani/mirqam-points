import { normalizePhone } from '@mirqam-points/shared'
import { Router } from 'express'
import rateLimit from 'express-rate-limit'
import { requireAuth, requireRole } from '../auth.js'
import { HttpError, idempotencyKey } from '../http.js'

// After paying, the customer must come back to the same address they signed in on: the
// session cookie is host-only, so returning to another Loyalty domain would ask them to log in again.
const RETURN_HOSTS = /^https:\/\/(loyalty\.mirqam\.sa|points\.mirqam\.sa|mirqam-points\.onrender\.com)$/
export function returnBase(req) {
  const origin = String(req.get('origin') || '')
  if (RETURN_HOSTS.test(origin)) return origin
  const own = `${req.protocol}://${req.get('host')}`
  return RETURN_HOSTS.test(own) ? own : undefined
}

export default function billingRoutes(billing, { db } = {}) {
  const r = Router()
  r.post('/moyasar/webhook', rateLimit({ windowMs: 60000, limit: 120 }), async (req, res) => {
    await billing.webhook(req.body)
    res.json({ ok: true })
  })
  // Every signed-in role sees the subscription state (it drives the renewal banner).
  r.get('/state', requireAuth, async (req, res) => res.json(await billing.state(req.auth.tenantId)))
  r.use(requireAuth, requireRole('owner'))
  r.get('/', async (req, res) => res.json(await billing.status(req.auth.tenantId)))
  // WhatsApp number for subscription reminders. Billing sends them through Mirqam Bot with a link
  // to the website's billing page (the iOS app cannot offer purchases itself).
  r.get('/contact', async (req, res) => {
    const { rows } = await db.query('SELECT billing_phone FROM tenants WHERE id = $1', [req.auth.tenantId])
    res.json({ phone: rows[0]?.billing_phone ?? null })
  })
  r.put('/contact', async (req, res) => {
    const raw = req.body?.phone
    const phone = raw == null || raw === '' ? null : normalizePhone(String(raw).slice(0, 32))
    if (raw != null && raw !== '' && !phone) throw new HttpError(400, 'validation_failed', [{ path: 'phone', message: 'invalid_phone' }])
    await db.query('UPDATE tenants SET billing_phone = $2 WHERE id = $1', [req.auth.tenantId, phone])
    let synced = false
    if (billing.remote && billing.ready && billing.syncAccount) {
      // Best effort: the number also travels with every later billing call.
      synced = await billing.syncAccount(req.auth.tenantId).then(
        () => true,
        () => false,
      )
    }
    res.json({ phone, synced })
  })
  r.get('/events', async (req, res) => {
    if (!billing.events) return res.json({ items: [] })
    const rows = await billing.events(req.auth.tenantId)
    res.json({ items: rows.map((e) => ({ id: e.id, kind: e.kind, data: e.data, emailStatus: e.email_status, createdAt: e.created_at })) })
  })
  r.post('/quote', rateLimit({ windowMs: 60000, limit: 20 }), async (req, res) => {
    if (!billing.remote) return res.json(await billing.preview(req.auth.tenantId, req.body.cycle, req.body.coupon))
    if (typeof req.body.coupon !== 'string' || !['monthly', 'yearly'].includes(req.body.cycle)) throw new HttpError(400, 'coupon_invalid')
    const v = await billing.validateCoupon(req.auth.tenantId, req.body.cycle, req.body.coupon.slice(0, 40))
    res.json({ subtotalMinor: v.subtotal_minor, discountMinor: v.discount_minor, amountMinor: v.total_minor, currency: 'SAR' })
  })
  r.post('/checkout', rateLimit({ windowMs: 60000, limit: 10 }), async (req, res) => {
    const coupon = typeof req.body.coupon === 'string' ? req.body.coupon.slice(0, 40) : ''
    const referral = String(req.headers.cookie || '').match(/(?:^|;\s*)__Secure-mirqam-ref-loyalty=([a-f0-9]{32})(?:;|$)/)?.[1] || ''
    const c = billing.remote
      ? await billing.checkout(req.auth.tenantId, req.body.cycle, idempotencyKey(req), {
          coupon: coupon || undefined,
          autoRenew: req.body.autoRenew === true,
          returnBase: returnBase(req),
          referral: referral || undefined,
        })
      : await billing.checkout(req.auth.tenantId, req.body.cycle, idempotencyKey(req), coupon, referral)
    res.json({ id: c.id, url: c.checkout_url, status: c.status, scheduled: Boolean(c.scheduled) })
  })
  // Unified billing only: coupons, auto-renew, cancel/resume and card updates.
  const remote = (req, _res, next) => (billing.remote ? next() : next(new HttpError(404, 'not_found')))
  r.post('/coupon', remote, rateLimit({ windowMs: 60000, limit: 20 }), async (req, res) => {
    if (typeof req.body.coupon !== 'string' || !['monthly', 'yearly'].includes(req.body.cycle)) throw new HttpError(400, 'validation_failed')
    res.json(await billing.validateCoupon(req.auth.tenantId, req.body.cycle, req.body.coupon.slice(0, 40)))
  })
  r.post('/cancel', remote, async (req, res) => res.json(await billing.cancel(req.auth.tenantId)))
  r.post('/resume', remote, async (req, res) => res.json(await billing.resume(req.auth.tenantId)))
  r.post('/auto-renew', remote, async (req, res) => res.json(await billing.autoRenew(req.auth.tenantId, req.body.enabled === true)))
  r.post('/payment-method', remote, rateLimit({ windowMs: 60000, limit: 10 }), async (req, res) => {
    const r2 = await billing.paymentMethod(req.auth.tenantId, returnBase(req))
    res.json({ url: r2.url, completed: Boolean(r2.completed) })
  })
  r.post('/checkout/:id/confirm', rateLimit({ windowMs: 60000, limit: 30 }), async (req, res) => {
    const c = await billing.confirm(req.auth.tenantId, req.params.id)
    res.json({ status: c.status })
  })
  return r
}
