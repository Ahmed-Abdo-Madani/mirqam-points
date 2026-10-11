/* Wallet service: loads pass models, renders Apple/Google passes and fans out
   update notifications after the ledger changes. Notifications are
   best-effort and never fail the transaction that triggered them — a pass
   that misses a push still refreshes the next time Wallet polls. */
import { HttpError } from '../http.js'
import { unseal } from '../secrets.js'
import { appleConfigured, buildPkpass, pushToDevices } from './apple.js'
import { deactivateLoyalty, googleConfigured, saveUrl, updateClass, updateObject } from './google.js'
import { GIFT_SQL, giftModel, LOYALTY_SQL, loyaltyModel } from './model.js'

export function createWallet({ db, config }) {
  const ctx = { apple: config.apple, google: config.google, publicUrl: config.publicUrl }
  const status = () => ({ apple: appleConfigured(config.apple), google: googleConfigured(config.google) })

  async function loyalty(where, params) {
    const { rows } = await db.query(`${LOYALTY_SQL} WHERE ${where}`, params)
    return rows[0] ? { model: loyaltyModel(rows[0], config.publicUrl), slug: rows[0].slug } : null
  }
  async function gift(where, params) {
    const { rows } = await db.query(`${GIFT_SQL} WHERE ${where}`, params)
    if (!rows[0]) return null
    return { model: giftModel(rows[0], unseal(rows[0].code_sealed, config.secretKey), config.publicUrl), slug: rows[0].slug, row: rows[0] }
  }

  const loyaltyByToken = (token) => loyalty('a.pass_token = $1', [token])
  const loyaltyById = (id) => loyalty('a.id = $1', [id])
  const giftByToken = (token) => gift('g.public_token = $1', [token])
  const giftById = (id) => gift('g.id = $1', [id])

  async function logoOf(model) {
    if (!model.logoVersion) return null
    const { rows } = await db.query('SELECT logo FROM tenants WHERE id = $1', [model.tenantId])
    return rows[0]?.logo ?? null
  }

  async function pkpass(model) {
    if (!status().apple) throw new HttpError(503, 'apple_wallet_unavailable')
    return buildPkpass(model, ctx, { logo: await logoOf(model) })
  }

  function googleUrl(model, slug) {
    if (!status().google) throw new HttpError(503, 'google_wallet_unavailable')
    return saveUrl(model, { ...ctx, slug })
  }

  async function pushApple(serial) {
    if (!status().apple) return
    const { rows } = await db.query('SELECT push_token FROM apple_registrations WHERE serial = $1 AND pass_type_id = $2', [serial, config.apple.passTypeId])
    const result = await pushToDevices(
      rows.map((r) => r.push_token),
      config.apple,
    )
    if (result.invalid.length) await db.query('DELETE FROM apple_registrations WHERE push_token = ANY($1)', [result.invalid])
  }

  function background(label, fn) {
    fn().catch((err) => console.warn(`[wallet] ${label} failed: ${err.message}`))
  }

  return {
    status,
    loyaltyByToken,
    loyaltyById,
    giftByToken,
    giftById,
    pkpass,
    googleUrl,
    /** After any ledger write on an account. */
    notifyAccount(accountId) {
      background(`notify account ${accountId}`, async () => {
        const found = await loyaltyById(accountId)
        if (!found) return
        await Promise.allSettled([pushApple(found.model.serial), status().google ? updateObject(found.model, { ...ctx, slug: found.slug }) : null])
      })
    },
    /** After a gift card balance or status change. */
    notifyGift(cardId) {
      background(`notify gift ${cardId}`, async () => {
        const found = await giftById(cardId)
        if (!found) return
        await Promise.allSettled([pushApple(found.model.serial), status().google ? updateObject(found.model, { ...ctx, slug: found.slug }) : null])
      })
    },
    /** After a program's name/design changes: every holder's pass refreshes. */
    notifyProgram(programId) {
      background(`notify program ${programId}`, async () => {
        const { rows } = await db.query('UPDATE accounts SET updated_at = now() WHERE program_id = $1 RETURNING id', [programId])
        for (const r of rows) {
          const found = await loyaltyById(r.id)
          if (found && status().google && r === rows[0])
            await updateClass(found.model, ctx).catch((err) => console.warn(`[wallet] class update failed: ${err.message}`))
          if (found) await Promise.allSettled([pushApple(found.model.serial), status().google ? updateObject(found.model, { ...ctx, slug: found.slug }) : null])
        }
      })
    },
    /** After reissue: the superseded pass is retired on both platforms. */
    retire(previousModel) {
      background(`retire ${previousModel.serial}`, async () => {
        await pushApple(previousModel.serial)
        if (status().google) await deactivateLoyalty(previousModel, ctx)
      })
    },
  }
}
