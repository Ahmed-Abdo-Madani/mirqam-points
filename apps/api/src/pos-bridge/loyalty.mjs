import { createHash, timingSafeEqual } from 'node:crypto'
import { computeEarn, DEFAULT_CONFIG, normalizePhone } from '@mirqam-points/shared'
import { z } from 'zod'
import { int } from '../db/index.js'
import { HttpError, parse } from '../http.js'
import { adjust, earn, ensureAccount, redeem, voidEntry } from '../ledger.js'

const hash = (v) =>
  createHash('sha256')
    .update(typeof v === 'string' ? v : JSON.stringify(v))
    .digest('base64url')
const safe = (a, b) => typeof a === 'string' && typeof b === 'string' && a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b))
const ref = z.string().min(1).max(120)
const amount = z.number().int().min(0).max(100000000)
const target = z.object({ phone: z.string().max(32), name: z.string().max(120).optional() })
const quoteBody = target.extend({ points: z.number().int().min(0).max(10000000).default(0), reward: z.boolean().default(false), maxDiscountMinor: amount })
const openBody = quoteBody.extend({ orderRef: ref, programId: z.string().uuid(), purchaseMinor: amount, discountMinor: amount })
const configBody = z.object({ programId: z.string().uuid(), pointsPerSar: z.number().int().min(1).max(1000000), stampRewardMinor: amount.default(0) })
const importBody = target.extend({ sourceRef: ref, units: z.number().int().min(1).max(10000000), type: z.enum(['points', 'stamps']) })
const atomic = (tx) => ({ ...tx, tx: (fn) => fn(tx) })

export function createPosLoyalty({ db, billing, wallet }) {
  const settings = async (q, t, pos) => {
    const row = (
      await q.query(
        'SELECT s.*,p.name,p.type,p.status,p.config FROM pos_loyalty_settings s JOIN programs p ON p.id=s.program_id AND p.tenant_id=s.tenant_id WHERE s.tenant_id=$1 AND s.pos_tenant=$2',
        [t, pos],
      )
    ).rows[0]
    if (!row) throw new HttpError(409, 'pos_loyalty_not_configured')
    return row
  }
  async function member(q, t, body, create = true) {
    const phone = normalizePhone(body.phone)
    if (!phone) throw new HttpError(400, 'invalid_phone')
    if (create)
      await q.query('INSERT INTO members(tenant_id,phone,name) VALUES($1,$2,$3) ON CONFLICT(tenant_id,phone) DO NOTHING', [t, phone, body.name || null])
    return (await q.query('SELECT id FROM members WHERE tenant_id=$1 AND phone=$2', [t, phone])).rows[0]
  }
  async function quote(q, t, pos, body) {
    const s = await settings(q, t, pos)
    if (s.status !== 'active') throw new HttpError(422, 'program_not_active')
    if ((body.points && body.reward) || (s.type === 'points' && body.reward) || (s.type === 'stamps' && body.points)) throw new HttpError(400, 'invalid_amount')
    const m = await member(q, t, body, false)
    const a = m ? (await q.query('SELECT * FROM accounts WHERE tenant_id=$1 AND program_id=$2 AND member_id=$3', [t, s.program_id, m.id])).rows[0] : null
    const config = { ...DEFAULT_CONFIG[s.type], ...s.config }
    const units = s.type === 'points' ? body.points : body.reward ? config.stampsRequired : 0
    const discountMinor = s.type === 'points' ? Math.floor((units * 100) / s.points_per_sar) : units ? int(s.stamp_reward_minor) : 0
    if (units && (discountMinor < 1 || discountMinor > body.maxDiscountMinor)) throw new HttpError(422, 'pos_discount_exceeds_sale')
    if (units > int(a?.balance ?? 0)) throw new HttpError(422, 'insufficient_balance')
    return {
      programId: s.program_id,
      programName: s.name,
      type: s.type,
      balance: int(a?.balance ?? 0),
      lifetimeEarned: int(a?.lifetime_earned ?? 0),
      pointsPerSar: s.points_per_sar,
      stampRewardMinor: int(s.stamp_reward_minor),
      stampsRequired: config.stampsRequired ?? null,
      units,
      discountMinor,
    }
  }
  const notify = (result) => {
    if (result?.accountId) wallet.notifyAccount(result.accountId)
    return result
  }
  return {
    async authorize(req) {
      const { linkId } = req.body ?? {},
        token = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(req.get('authorization') || '')?.[1]
      if (typeof linkId !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(linkId) || !token) throw new HttpError(401, 'unauthenticated')
      const row = (await db.query('SELECT data FROM pos_account_links WHERE key=$1', ['link:' + linkId])).rows[0]?.data
      if (!row?.active || !safe(row.loyaltyAccessHash, hash(token)) || !row.posTenant) throw new HttpError(403, 'pos_link_unavailable')
      if (!(await db.query('SELECT 1 FROM tenants WHERE id=$1 AND closed_at IS NULL', [row.identity.id])).rows.length)
        throw new HttpError(403, 'pos_link_unavailable')
      // Financial reversals remain possible after expiry; new earns/redemptions do not.
      if (!['reverse', 'status', 'balance', 'settle'].includes(req.params.action) && (await billing.entitlement(row.identity.id)).allowed === false)
        throw new HttpError(402, 'subscription_required')
      return { tenantId: row.identity.id, posTenant: row.posTenant }
    },
    async run(action, t, pos, raw) {
      if (action === 'status') {
        const programs = (await db.query("SELECT id,name,type,config FROM programs WHERE tenant_id=$1 AND status='active' ORDER BY created_at", [t])).rows
        const configured =
          (
            await db.query(
              'SELECT program_id AS "programId",points_per_sar AS "pointsPerSar",stamp_reward_minor::int AS "stampRewardMinor" FROM pos_loyalty_settings WHERE tenant_id=$1 AND pos_tenant=$2',
              [t, pos],
            )
          ).rows[0] ?? null
        return { programs, configured }
      }
      if (action === 'configure') {
        const b = parse(configBody, raw)
        if (!(await db.query("SELECT 1 FROM programs WHERE id=$1 AND tenant_id=$2 AND status='active'", [b.programId, t])).rows.length)
          throw new HttpError(404, 'program_not_found')
        const old = (await db.query('SELECT * FROM pos_loyalty_settings WHERE tenant_id=$1 OR pos_tenant=$2', [t, pos])).rows[0]
        if (old && (old.tenant_id !== t || old.pos_tenant !== pos)) throw new HttpError(409, 'pos_link_conflict')
        await db.query(
          'INSERT INTO pos_loyalty_settings(tenant_id,pos_tenant,program_id,points_per_sar,stamp_reward_minor) VALUES($1,$2,$3,$4,$5) ON CONFLICT(tenant_id) DO UPDATE SET program_id=EXCLUDED.program_id,points_per_sar=EXCLUDED.points_per_sar,stamp_reward_minor=EXCLUDED.stamp_reward_minor',
          [t, pos, b.programId, b.pointsPerSar, b.stampRewardMinor],
        )
        return { ok: true }
      }
      if (action === 'balance') return quote(db, t, pos, { ...parse(target, raw), points: 0, reward: false, maxDiscountMinor: 100000000 })
      if (action === 'quote') return quote(db, t, pos, parse(quoteBody, raw))
      if (action === 'import') {
        const b = parse(importBody, raw)
        return notify(
          await db.tx(async (tx) => {
            await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`pos:${t}:${pos}:import:${b.sourceRef}`])
            const digest = hash(b),
              prior = (await tx.query('SELECT * FROM pos_loyalty_imports WHERE tenant_id=$1 AND pos_tenant=$2 AND source_ref=$3', [t, pos, b.sourceRef]))
                .rows[0]
            if (prior) {
              if (prior.request_hash !== digest) throw new HttpError(409, 'idempotency_mismatch')
              return { ok: true, replayed: true, accountId: prior.account_id }
            }
            const s = await settings(tx, t, pos)
            if (s.type !== b.type) throw new HttpError(409, 'pos_program_type_mismatch')
            const m = await member(tx, t, b),
              a = await ensureAccount(tx, { tenantId: t, programId: s.program_id, memberId: m.id })
            await adjust(atomic(tx), {
              tenantId: t,
              accountId: a.id,
              points: b.units,
              idempotencyKey: 'pos-import:' + hash([pos, b.sourceRef]),
              source: 'pos',
              note: 'نقل رصيد محاسبي إلى الرصيد الموحد',
            })
            await tx.query('INSERT INTO pos_loyalty_imports(tenant_id,pos_tenant,source_ref,request_hash,account_id) VALUES($1,$2,$3,$4,$5)', [
              t,
              pos,
              b.sourceRef,
              digest,
              a.id,
            ])
            return { ok: true, accountId: a.id }
          }),
        )
      }
      if (!['open', 'settle', 'reverse'].includes(action)) throw new HttpError(404, 'not_found')
      const b = action === 'open' ? parse(openBody, raw) : parse(z.object({ orderRef: ref }), raw)
      return notify(
        await db.tx(async (tx) => {
          const key = `pos:${t}:${pos}:${b.orderRef}`
          await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))', [key])
          const sale = (
            await tx.query('SELECT * FROM pos_loyalty_sales WHERE tenant_id=$1 AND pos_tenant=$2 AND order_ref=$3 FOR UPDATE', [t, pos, b.orderRef])
          ).rows[0]
          const ledger = atomic(tx),
            meta = { tenantId: t, source: 'pos', ref: b.orderRef }
          if (action === 'open') {
            const digest = hash(b)
            if (sale) {
              if (sale.state === 'REVERSED') throw new HttpError(409, 'pos_sale_reversed')
              if (sale.request_hash !== digest) throw new HttpError(409, 'idempotency_mismatch')
              return { ok: true, replayed: true, discountMinor: int(sale.discount_minor), accountId: sale.account_id }
            }
            const result = await quote(tx, t, pos, b)
            if (result.programId !== b.programId || result.discountMinor !== b.discountMinor) throw new HttpError(409, 'pos_quote_changed')
            const m = await member(tx, t, b),
              a = await ensureAccount(tx, { tenantId: t, programId: b.programId, memberId: m.id })
            const program = (await tx.query('SELECT type,config FROM programs WHERE id=$1 AND tenant_id=$2', [b.programId, t])).rows[0]
            const earnUnits = b.purchaseMinor > 0 ? computeEarn(program.type, { ...DEFAULT_CONFIG[program.type], ...program.config }, b.purchaseMinor) : 0
            const burned = result.units
              ? await redeem(ledger, { ...meta, accountId: a.id, points: result.units, idempotencyKey: 'pos-redeem:' + hash([pos, b.orderRef]) })
              : null
            await tx.query(
              "INSERT INTO pos_loyalty_sales(tenant_id,pos_tenant,order_ref,request_hash,account_id,program_id,purchase_minor,discount_minor,redeemed,state,redeem_entry,earn_units) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'OPEN',$10,$11)",
              [t, pos, b.orderRef, digest, a.id, b.programId, b.purchaseMinor, b.discountMinor, result.units, burned?.entry.id ?? null, earnUnits],
            )
            return { ok: true, discountMinor: result.discountMinor, accountId: a.id }
          }
          if (action === 'reverse') {
            if (!sale) {
              await tx.query(
                "INSERT INTO pos_loyalty_sales(tenant_id,pos_tenant,order_ref,request_hash,state) VALUES($1,$2,$3,'cancelled-before-open','REVERSED')",
                [t, pos, b.orderRef],
              )
              return { ok: true }
            }
            if (sale.state === 'REVERSED') return { ok: true, replayed: true, accountId: sale.account_id }
            // Restore the burn first so a normal earn+redeem refund can unwind atomically.
            if (sale.redeem_entry) await voidEntry(ledger, { ...meta, entryId: sale.redeem_entry, idempotencyKey: 'pos-unredeem:' + hash([pos, b.orderRef]) })
            if (sale.earn_entry) await voidEntry(ledger, { ...meta, entryId: sale.earn_entry, idempotencyKey: 'pos-unearn:' + hash([pos, b.orderRef]) })
            await tx.query("UPDATE pos_loyalty_sales SET state='REVERSED',updated_at=now() WHERE tenant_id=$1 AND pos_tenant=$2 AND order_ref=$3", [
              t,
              pos,
              b.orderRef,
            ])
            return { ok: true, accountId: sale.account_id }
          }
          if (!sale) throw new HttpError(409, 'pos_sale_not_open')
          if (sale.state === 'REVERSED') throw new HttpError(409, 'pos_sale_reversed')
          if (sale.state === 'PAID') return { ok: true, replayed: true, accountId: sale.account_id }
          const units = sale.earn_units
          const earned =
            units > 0
              ? await earn(ledger, {
                  ...meta,
                  accountId: sale.account_id,
                  points: units,
                  purchaseMinor: int(sale.purchase_minor),
                  idempotencyKey: 'pos-earn:' + hash([pos, b.orderRef]),
                })
              : null
          await tx.query("UPDATE pos_loyalty_sales SET state='PAID',earn_entry=$4,updated_at=now() WHERE tenant_id=$1 AND pos_tenant=$2 AND order_ref=$3", [
            t,
            pos,
            b.orderRef,
            earned?.entry.id ?? null,
          ])
          return { ok: true, earned: units, accountId: sale.account_id }
        }),
      )
    },
  }
}
export function installPosLoyalty({ app, db, billing, wallet }) {
  const service = createPosLoyalty({ db, billing, wallet })
  app.post('/api/pos/loyalty/:action', async (req, res, next) => {
    try {
      res.set('Cache-Control', 'no-store')
      const a = await service.authorize(req)
      res.json(await service.run(req.params.action, a.tenantId, a.posTenant, req.body))
    } catch (e) {
      next(e)
    }
  })
}
