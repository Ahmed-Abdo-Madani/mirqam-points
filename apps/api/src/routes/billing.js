import { Router } from 'express'
import rateLimit from 'express-rate-limit'
import { requireAuth, requireRole } from '../auth.js'
import { idempotencyKey } from '../http.js'
export default function billingRoutes(billing) {
  const r = Router()
  r.post('/moyasar/webhook', rateLimit({ windowMs: 60000, limit: 120 }), async (req, res) => {
    await billing.webhook(req.body)
    res.json({ ok: true })
  })
  r.use(requireAuth, requireRole('owner'))
  r.get('/', async (req, res) => res.json(await billing.status(req.auth.tenantId)))
  r.post('/checkout', rateLimit({ windowMs: 60000, limit: 10 }), async (req, res) => {
    const c = await billing.checkout(req.auth.tenantId, req.body.cycle, idempotencyKey(req))
    res.json({ id: c.id, url: c.checkout_url, status: c.status })
  })
  r.post('/checkout/:id/confirm', rateLimit({ windowMs: 60000, limit: 30 }), async (req, res) => {
    const c = await billing.confirm(req.auth.tenantId, req.params.id)
    res.json({ status: c.status })
  })
  return r
}
