import { Router } from 'express'
import rateLimit from 'express-rate-limit'
import { requireAuth, requireRole } from '../auth.js'
import { HttpError, idempotencyKey } from '../http.js'

export default function billingRoutes(billing) {
  const r = Router()
  r.post('/moyasar/webhook', rateLimit({ windowMs: 60000, limit: 120 }), async (req, res) => {
    await billing.webhook(req.body)
    res.json({ ok: true })
  })
  // Every signed-in role sees the subscription state (it drives the renewal banner).
  r.get('/state', requireAuth, async (req, res) => res.json(await billing.state(req.auth.tenantId)))
  r.use(requireAuth, requireRole('owner'))
  r.get('/', async (req, res) => res.json(await billing.status(req.auth.tenantId)))
  r.get('/events', async (req, res) => {
    const rows = await billing.events(req.auth.tenantId)
    res.json({ items: rows.map((e) => ({ id: e.id, kind: e.kind, data: e.data, emailStatus: e.email_status, createdAt: e.created_at })) })
  })
  r.post('/checkout', rateLimit({ windowMs: 60000, limit: 10 }), async (req, res) => {
    const opts = { coupon: typeof req.body.coupon === 'string' ? req.body.coupon.slice(0, 40) : undefined, autoRenew: req.body.autoRenew === true }
    const c = await billing.checkout(req.auth.tenantId, req.body.cycle, idempotencyKey(req), opts)
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
    const r2 = await billing.paymentMethod(req.auth.tenantId)
    res.json({ url: r2.url, completed: Boolean(r2.completed) })
  })
  r.post('/checkout/:id/confirm', rateLimit({ windowMs: 60000, limit: 30 }), async (req, res) => {
    const c = await billing.confirm(req.auth.tenantId, req.params.id)
    res.json({ status: c.status })
  })
  return r
}
