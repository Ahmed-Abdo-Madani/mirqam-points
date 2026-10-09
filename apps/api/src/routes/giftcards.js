import { normalizePhone } from '@mirqam-points/shared'
import { Router } from 'express'
import { z } from 'zod'
import { requireAuth, requireRole } from '../auth.js'
import { int } from '../db/index.js'
import { findByCode, issue, mapCard, mapGiftEntry, redeem, voidCard } from '../giftcards.js'
import { HttpError, id, idempotencyKey, pageQuery, parse } from '../http.js'
import { audit } from './util.js'

const issueBody = z.object({
  amountMinor: z.number().int().min(100).max(100_000_000),
  expiresInMonths: z.number().int().min(1).max(60).nullable().default(12),
  recipientName: z.string().trim().min(1).max(120).optional(),
  recipientPhone: z.string().max(32).optional(),
  senderName: z.string().trim().min(1).max(120).optional(),
  message: z.string().trim().min(1).max(300).optional(),
})
const codeBody = z.object({ code: z.string().trim().min(16).max(40) })
const redeemBody = codeBody.extend({ amountMinor: z.number().int().min(1).max(100_000_000), ref: z.string().trim().max(120).optional() })
const listQuery = pageQuery.extend({ status: z.enum(['active', 'frozen', 'voided']).optional(), q: z.string().trim().max(20).optional() })

export default function giftCardRoutes({ db, config, wallet }) {
  const r = Router()
  r.use(requireAuth)
  const actor = (req) => ({ tenantId: req.auth.tenantId, actorUserId: req.auth.userId, idempotencyKey: idempotencyKey(req) })

  r.get('/', async (req, res) => {
    const q = parse(listQuery, req.query)
    const where = ['tenant_id = $1']
    const params = [req.auth.tenantId]
    if (q.status) {
      params.push(q.status)
      where.push(`status = $${params.length}`)
    }
    if (q.q) {
      params.push(`%${q.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`)
      where.push(`(code_last4 ILIKE $${params.length} OR recipient_name ILIKE $${params.length} OR recipient_phone LIKE $${params.length})`)
    }
    const filter = where.join(' AND ')
    const [
      { rows },
      {
        rows: [totals],
      },
    ] = await Promise.all([
      db.query(`SELECT * FROM gift_cards WHERE ${filter} ORDER BY created_at DESC LIMIT ${q.limit} OFFSET ${q.offset}`, params),
      db.query(
        `SELECT count(*)::int AS total,
                COALESCE(SUM(balance_minor) FILTER (WHERE status <> 'voided'), 0) AS outstanding,
                COALESCE(SUM(initial_minor), 0) AS issued
           FROM gift_cards WHERE ${filter}`,
        params,
      ),
    ])
    res.json({
      items: rows.map(mapCard),
      total: totals.total,
      outstandingMinor: int(totals.outstanding),
      issuedMinor: int(totals.issued),
      limit: q.limit,
      offset: q.offset,
    })
  })

  // Cashiers sell cards at the counter (payment is taken on the merchant's own POS).
  r.post('/', requireRole('manager', 'cashier'), async (req, res) => {
    const body = parse(issueBody, req.body)
    let recipientPhone = null
    if (body.recipientPhone) {
      recipientPhone = normalizePhone(body.recipientPhone)
      if (!recipientPhone) throw new HttpError(400, 'validation_failed', [{ path: 'recipientPhone', message: 'invalid_phone' }])
    }
    const expiresAt = body.expiresInMonths ? new Date(Date.now() + body.expiresInMonths * 30.44 * 86_400_000).toISOString().slice(0, 10) : null
    const result = await issue(
      db,
      {
        ...actor(req),
        amountMinor: body.amountMinor,
        expiresAt,
        recipientName: body.recipientName ?? null,
        recipientPhone,
        senderName: body.senderName ?? null,
        message: body.message ?? null,
      },
      config.secretKey,
    )
    if (!result.replayed) await audit(db, req, 'gift_card.issued', result.card.id, { amountMinor: body.amountMinor })
    res.status(result.replayed ? 200 : 201).json({ ...result, url: `${config.publicUrl}/gift/${result.card.publicToken}` })
  })

  r.post('/lookup', requireRole('manager', 'cashier'), async (req, res) => {
    const { code } = parse(codeBody, req.body)
    const card = await findByCode(db, req.auth.tenantId, code)
    if (!card) throw new HttpError(404, 'gift_card_not_found')
    res.json(mapCard(card))
  })

  r.post('/redeem', requireRole('manager', 'cashier'), async (req, res) => {
    const body = parse(redeemBody, req.body)
    const card = await findByCode(db, req.auth.tenantId, body.code)
    if (!card) throw new HttpError(404, 'gift_card_not_found')
    const result = await redeem(db, { ...actor(req), cardId: card.id, amountMinor: body.amountMinor, ref: body.ref })
    if (!result.replayed) wallet.notifyGift(card.id)
    res.status(result.replayed ? 200 : 201).json(result)
  })

  r.get('/:id', async (req, res) => {
    const cardId = parse(id, req.params.id)
    const {
      rows: [card],
    } = await db.query('SELECT * FROM gift_cards WHERE id = $1 AND tenant_id = $2', [cardId, req.auth.tenantId])
    if (!card) throw new HttpError(404, 'gift_card_not_found')
    const { rows } = await db.query(
      `SELECT e.*, u.name AS actor_name FROM gift_card_entries e LEFT JOIN users u ON u.id = e.actor_user_id
        WHERE e.gift_card_id = $1 ORDER BY e.created_at DESC`,
      [cardId],
    )
    res.json({ ...mapCard(card), url: `${config.publicUrl}/gift/${card.public_token}`, entries: rows.map(mapGiftEntry) })
  })

  r.post('/:id/status', requireRole('manager'), async (req, res) => {
    const cardId = parse(id, req.params.id)
    const { status } = parse(z.object({ status: z.enum(['active', 'frozen']) }), req.body)
    const {
      rows: [card],
    } = await db.query(`UPDATE gift_cards SET status = $3, updated_at = now() WHERE id = $1 AND tenant_id = $2 AND status <> 'voided' RETURNING *`, [
      cardId,
      req.auth.tenantId,
      status,
    ])
    if (!card) throw new HttpError(404, 'gift_card_not_found')
    await audit(db, req, `gift_card.${status === 'frozen' ? 'frozen' : 'unfrozen'}`, cardId)
    wallet.notifyGift(cardId)
    res.json(mapCard(card))
  })

  r.post('/:id/void', requireRole('manager'), async (req, res) => {
    const cardId = parse(id, req.params.id)
    const note = parse(z.object({ note: z.string().trim().max(500).optional() }), req.body).note
    const {
      rows: [card],
    } = await db.query('SELECT balance_minor, status FROM gift_cards WHERE id = $1 AND tenant_id = $2', [cardId, req.auth.tenantId])
    if (!card) throw new HttpError(404, 'gift_card_not_found')
    let result
    if (int(card.balance_minor) === 0 && card.status !== 'voided') {
      // Nothing to write off: retire the card without a ledger entry.
      const { rows } = await db.query("UPDATE gift_cards SET status = 'voided', updated_at = now() WHERE id = $1 RETURNING *", [cardId])
      result = { card: mapCard(rows[0]), replayed: false }
    } else {
      result = await voidCard(db, { ...actor(req), cardId, note })
    }
    if (!result.replayed) {
      await audit(db, req, 'gift_card.voided', cardId, { note })
      wallet.notifyGift(cardId)
    }
    res.status(result.replayed ? 200 : 201).json(result)
  })

  return r
}
