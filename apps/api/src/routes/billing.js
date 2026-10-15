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
  // Every signed-in role sees the subscription state (it drives the renewal banner).
  r.get('/state', requireAuth, async (req, res) => res.json(await billing.state(req.auth.tenantId)))
  r.use(requireAuth, requireRole('owner'))
  r.get('/', async (req, res) => res.json(await billing.status(req.auth.tenantId)))
  r.get('/events', async (req, res) => {
    const rows = await billing.events(req.auth.tenantId)
    res.json({ items: rows.map((e) => ({ id: e.id, kind: e.kind, data: e.data, emailStatus: e.email_status, createdAt: e.created_at })) })
  })
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
