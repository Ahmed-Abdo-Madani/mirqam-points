import { z } from 'zod'
import { LedgerError } from './ledger.js'

export class HttpError extends Error {
  constructor(status, code, details) {
    super(code)
    this.status = status
    this.code = code
    this.details = details
  }
}

/** Parses `data` with a zod schema or throws 400 validation_failed with field paths. */
export function parse(schema, data) {
  const result = schema.safeParse(data)
  if (result.success) return result.data
  throw new HttpError(
    400,
    'validation_failed',
    result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
  )
}

/** Idempotency key from the standard header, falling back to the body. */
export function idempotencyKey(req) {
  const key = req.get('idempotency-key') || req.body?.idempotencyKey
  if (typeof key !== 'string' || key.length < 8 || key.length > 128) throw new HttpError(400, 'idempotency_key_required')
  return key
}

export function errorHandler(err, req, res, _next) {
  if (err instanceof HttpError || err instanceof LedgerError) {
    return res.status(err.status).json({ error: err.code, ...(err.details ? { details: err.details } : {}) })
  }
  if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'invalid_json' })
  if (err?.type === 'entity.too.large') return res.status(413).json({ error: 'payload_too_large' })
  console.error(`[api] ${req.method} ${req.originalUrl}`, err)
  res.status(500).json({ error: 'internal_error' })
}

export const id = z.string().uuid()
export const pageQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
})
