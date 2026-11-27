import { Router } from 'express'
import rateLimit from 'express-rate-limit'
import { requireAuth, requireRole } from '../auth.js'
import { HttpError } from '../http.js'

/* /api/pager: the pager counter inside Mirqam Loyalty (pager-counter.js). Owner, manager and cashier run
   tickets; owner and manager change settings, branches and brand and see reports. Mounted outside the
   loyalty paywall: a pager-only business never needs a loyalty subscription to page its customers. */
const ID = /^[A-Za-z0-9_-]{1,80}$/
const id = (value) => {
  if (!ID.test(String(value))) throw new HttpError(404, 'not_found')
  return encodeURIComponent(value)
}
const pick = (body, keys) => Object.fromEntries(keys.filter((k) => body?.[k] !== undefined).map((k) => [k, body[k]]))

export default function pagerRoutes(counter) {
  const r = Router()
  const staff = [requireAuth, requireRole('manager', 'cashier')]
  const manage = [requireAuth, requireRole('manager')]
  const live = async (req, _res, next) => {
    try {
      await counter.requireLive(req.auth.tenantId)
      next()
    } catch (err) {
      next(err)
    }
  }
  const pass = (method, path, keys) => async (req, res) => {
    const body = keys ? pick(req.body, keys) : undefined
    res.json(await counter.bridge(req.auth.tenantId, method, typeof path === 'function' ? path(req) : path, body))
  }

  // Never an error for a workspace without the plan: { status: 'no_plan' | 'starting' | 'live', ... }.
  r.get('/', ...staff, async (req, res) => res.json(await counter.overview(req.auth.tenantId)))
  // Cheap, no POS call: the menu and the phone tabs use it.
  r.get('/nav', requireAuth, async (req, res) => res.json(await counter.nav(req.auth.tenantId)))

  // ------------------------------------------------------------- counter
  r.get('/branches/:branchId/tickets', ...staff, live, async (req, res) => {
    const v = typeof req.query.version === 'string' ? `?version=${encodeURIComponent(req.query.version.slice(0, 80))}` : ''
    res.json(await counter.bridge(req.auth.tenantId, 'GET', `/branches/${id(req.params.branchId)}/tickets${v}`))
  })
  r.post(
    '/branches/:branchId/tickets',
    ...staff,
    rateLimit({ windowMs: 60000, limit: 120 }),
    live,
    pass('POST', (req) => `/branches/${id(req.params.branchId)}/tickets`, ['number', 'amountMinor', 'items']),
  )
  r.post(
    '/tickets/:id/call',
    ...staff,
    live,
    pass('POST', (req) => `/tickets/${id(req.params.id)}/call`),
  )
  r.post(
    '/tickets/:id/close',
    ...staff,
    live,
    pass('POST', (req) => `/tickets/${id(req.params.id)}/close`),
  )
  // Staff print or show the counter QR.
  r.get(
    '/branches/:branchId/counter-qr',
    ...staff,
    live,
    pass('GET', (req) => `/branches/${id(req.params.branchId)}/counter-qr`),
  )

  // -------------------------------------------------------------- manage
  r.post('/branches', ...manage, live, pass('POST', '/branches', ['name']))
  r.patch(
    '/branches/:branchId',
    ...manage,
    live,
    pass('PATCH', (req) => `/branches/${id(req.params.branchId)}`, ['name']),
  )
  // Read for every staff role (the counter's side rail opens it); making or replacing it stays with managers.
  r.get(
    '/branches/:branchId/call-screen',
    ...staff,
    live,
    pass('GET', (req) => `/branches/${id(req.params.branchId)}/call-screen`),
  )
  r.post(
    '/branches/:branchId/call-screen',
    ...manage,
    live,
    pass('POST', (req) => `/branches/${id(req.params.branchId)}/call-screen`),
  )
  r.put('/settings', ...manage, live, pass('PUT', '/settings', ['sound', 'expiryHours', 'printOnReceipt', 'screenReadyMinutes']))
  r.get('/brand', ...manage, live, pass('GET', '/brand'))
  r.put('/brand', ...manage, live, pass('PUT', '/brand', ['name', 'nameAr', 'logoUrl', 'primaryColor', 'accentColor']))
  const reportQuery = (req) => {
    const q = new URLSearchParams()
    for (const k of ['from', 'to', 'branchId']) if (typeof req.query[k] === 'string') q.set(k, req.query[k].slice(0, 80))
    return q.toString()
  }
  r.get(
    '/reports',
    ...manage,
    live,
    pass('GET', (req) => `/reports?${reportQuery(req)}`),
  )
  r.get(
    '/reports/csv',
    ...manage,
    live,
    pass('GET', (req) => `/reports/csv?${reportQuery(req)}`),
  )
  return r
}
