import { computeEarn } from '@mirqam-points/shared'
import { Router } from 'express'
import { z } from 'zod'
import { requireAuth, requireRole } from '../auth.js'
import { int } from '../db/index.js'
import { HttpError, id, idempotencyKey, pageQuery, parse } from '../http.js'
import { adjust, earn, ensureAccount, mapEntry, redeem, voidEntry } from '../ledger.js'
import { audit } from './util.js'

const ref = z.string().trim().max(120).optional()
const note = z.string().trim().max(500).optional()
const target = { programId: id, memberId: id }
const source = z.enum(['console', 'pos']).default('console')

// purchaseMinor is optional: a stamp card can award a visit without a bill amount.
const earnBody = z.object({ ...target, purchaseMinor: z.number().int().min(0).max(100_000_000).optional(), ref, note, source })
const redeemBody = z.object({ ...target, points: z.number().int().min(1).max(10_000_000), ref, note, source })
const adjustBody = z.object({
  ...target,
  points: z
    .number()
    .int()
    .min(-10_000_000)
    .max(10_000_000)
    .refine((v) => v !== 0),
  note: z.string().trim().min(3).max(500),
})
const voidBody = z.object({ entryId: id, note })
const listQuery = pageQuery.extend({
  memberId: id.optional(),
  programId: id.optional(),
  kind: z.enum(['earn', 'redeem', 'adjust', 'void', 'expire']).optional(),
})

async function loadTarget(db, tenantId, { programId, memberId }) {
  const {
    rows: [program],
  } = await db.query('SELECT * FROM programs WHERE id = $1 AND tenant_id = $2', [programId, tenantId])
  if (!program) throw new HttpError(404, 'program_not_found')
  const {
    rows: [member],
  } = await db.query('SELECT id FROM members WHERE id = $1 AND tenant_id = $2', [memberId, tenantId])
  if (!member) throw new HttpError(404, 'member_not_found')
  return program
}

const actor = (req, extra) => ({ tenantId: req.auth.tenantId, actorUserId: req.auth.userId, idempotencyKey: idempotencyKey(req), ...extra })

export default function ledgerRoutes({ db, wallet }) {
  const r = Router()
  r.use(requireAuth)

  // Points are computed server-side from the purchase so a cashier cannot type arbitrary points.
  r.post('/earn', requireRole('manager', 'cashier'), async (req, res) => {
    const body = parse(earnBody, req.body)
    const program = await loadTarget(db, req.auth.tenantId, body)
    if (program.status !== 'active') throw new HttpError(422, 'program_not_active')
    // Without an amount only a stamp card with no minimum purchase can earn (a flat stamp per visit).
    if (body.purchaseMinor == null && (program.type !== 'stamps' || program.config.minPurchaseMinor > 0)) throw new HttpError(422, 'purchase_required')
    const points = computeEarn(program.type, program.config, body.purchaseMinor ?? 0)
    if (points <= 0) throw new HttpError(422, 'nothing_to_earn')
    const account = await ensureAccount(db, { tenantId: req.auth.tenantId, ...body })
    const result = await earn(
      db,
      actor(req, { accountId: account.id, points, purchaseMinor: body.purchaseMinor, ref: body.ref, note: body.note, source: body.source }),
    )
    // Wallet passes refresh in the background; the transaction never waits on Apple/Google.
    if (!result.replayed) wallet.notifyAccount(result.entry.accountId)
    res.status(result.replayed ? 200 : 201).json(result)
  })

  r.post('/redeem', requireRole('manager', 'cashier'), async (req, res) => {
    const body = parse(redeemBody, req.body)
    const program = await loadTarget(db, req.auth.tenantId, body)
    if (program.status !== 'active') throw new HttpError(422, 'program_not_active')
    const {
      rows: [account],
    } = await db.query('SELECT id FROM accounts WHERE program_id = $1 AND member_id = $2 AND tenant_id = $3', [
      body.programId,
      body.memberId,
      req.auth.tenantId,
    ])
    if (!account) throw new HttpError(422, 'insufficient_balance')
    const result = await redeem(db, actor(req, { accountId: account.id, points: body.points, ref: body.ref, note: body.note, source: body.source }))
    // Wallet passes refresh in the background; the transaction never waits on Apple/Google.
    if (!result.replayed) wallet.notifyAccount(result.entry.accountId)
    res.status(result.replayed ? 200 : 201).json(result)
  })

  r.post('/adjust', requireRole('manager'), async (req, res) => {
    const body = parse(adjustBody, req.body)
    await loadTarget(db, req.auth.tenantId, body)
    const account = await ensureAccount(db, { tenantId: req.auth.tenantId, ...body })
    const result = await adjust(db, actor(req, { accountId: account.id, points: body.points, note: body.note }))
    if (!result.replayed) await audit(db, req, 'ledger.adjusted', result.entry.id, { points: body.points, note: body.note })
    // Wallet passes refresh in the background; the transaction never waits on Apple/Google.
    if (!result.replayed) wallet.notifyAccount(result.entry.accountId)
    res.status(result.replayed ? 200 : 201).json(result)
  })

  r.post('/void', requireRole('manager'), async (req, res) => {
    const body = parse(voidBody, req.body)
    const result = await voidEntry(db, actor(req, { entryId: body.entryId, note: body.note }))
    if (!result.replayed) await audit(db, req, 'ledger.voided', body.entryId, { note: body.note })
    // Wallet passes refresh in the background; the transaction never waits on Apple/Google.
    if (!result.replayed) wallet.notifyAccount(result.entry.accountId)
    res.status(result.replayed ? 200 : 201).json(result)
  })

  r.get('/entries', async (req, res) => {
    const q = parse(listQuery, req.query)
    const where = ['e.tenant_id = $1']
    const params = [req.auth.tenantId]
    for (const [col, value] of [
      ['a.member_id', q.memberId],
      ['a.program_id', q.programId],
      ['e.kind', q.kind],
    ]) {
      if (value) {
        params.push(value)
        where.push(`${col} = $${params.length}`)
      }
    }
    const filter = where.join(' AND ')
    const from = 'FROM ledger_entries e JOIN accounts a ON a.id = e.account_id'
    const [
      { rows },
      {
        rows: [count],
      },
    ] = await Promise.all([
      db.query(
        `SELECT e.*, a.member_id, a.program_id, m.phone, m.name AS member_name, p.name AS program_name, p.type AS program_type,
                u.name AS actor_name,
                (SELECT 1 FROM ledger_entries v WHERE v.reverses_entry_id = e.id) IS NOT NULL AS voided
           ${from}
           JOIN members m ON m.id = a.member_id
           JOIN programs p ON p.id = a.program_id
           LEFT JOIN users u ON u.id = e.actor_user_id
          WHERE ${filter} ORDER BY e.created_at DESC LIMIT ${q.limit} OFFSET ${q.offset}`,
        params,
      ),
      db.query(`SELECT count(*)::int AS total ${from} WHERE ${filter}`, params),
    ])
    res.json({
      items: rows.map((e) => ({
        ...mapEntry(e),
        voided: e.voided,
        member: { id: e.member_id, phone: e.phone, name: e.member_name },
        program: { id: e.program_id, name: e.program_name, type: e.program_type },
        actorName: e.actor_name,
      })),
      total: count.total,
      limit: q.limit,
      offset: q.offset,
    })
  })

  /* Totals are split by program type: points and stamps are different units
     and summing them would produce a meaningless number. */
  r.get('/summary', async (req, res) => {
    const t = req.auth.tenantId
    const [
      { rows: flows },
      { rows: balances },
      {
        rows: [counts],
      },
    ] = await Promise.all([
      db.query(
        `SELECT p.type,
                COALESCE(SUM(e.amount) FILTER (WHERE e.kind = 'earn'), 0) AS earned,
                COALESCE(-SUM(e.amount) FILTER (WHERE e.kind = 'redeem'), 0) AS redeemed
           FROM ledger_entries e JOIN accounts a ON a.id = e.account_id JOIN programs p ON p.id = a.program_id
          WHERE e.tenant_id = $1 GROUP BY p.type`,
        [t],
      ),
      db.query(
        `SELECT p.type, COALESCE(SUM(a.balance), 0) AS outstanding
           FROM accounts a JOIN programs p ON p.id = a.program_id
          WHERE a.tenant_id = $1 GROUP BY p.type`,
        [t],
      ),
      db.query(
        `SELECT (SELECT count(*) FROM members WHERE tenant_id = $1) AS members,
                (SELECT count(*) FROM members WHERE tenant_id = $1 AND created_at > now() - interval '30 days') AS members_30d,
                (SELECT count(*) FROM programs WHERE tenant_id = $1 AND status = 'active') AS active_programs,
                (SELECT count(*) FROM ledger_entries WHERE tenant_id = $1 AND created_at > now() - interval '30 days') AS entries_30d`,
        [t],
      ),
    ])
    const byType = (type) => {
      const flow = flows.find((r) => r.type === type)
      const bal = balances.find((r) => r.type === type)
      return { earned: int(flow?.earned ?? 0), redeemed: int(flow?.redeemed ?? 0), outstanding: int(bal?.outstanding ?? 0) }
    }
    res.json({
      members: int(counts.members),
      members30d: int(counts.members_30d),
      activePrograms: int(counts.active_programs),
      entries30d: int(counts.entries_30d),
      points: byType('points'),
      stamps: byType('stamps'),
    })
  })

  return r
}
