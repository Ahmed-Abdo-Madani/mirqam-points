/* Merchant branding: the logo that replaces Mirqam's mark on wallet cards. */
import { Router } from 'express'
import { z } from 'zod'
import { requireAuth, requireRole } from '../auth.js'
import { HttpError, parse } from '../http.js'
import { inspectLogo } from '../wallet/strip.js'
import { audit } from './util.js'

const MAX_LOGO_BYTES = 300_000
const body = z.object({ png: z.string().max(420_000) }).strict()

export default function brandingRoutes({ db, wallet }) {
  const r = Router()
  r.use(requireAuth)

  async function refreshPasses(req) {
    const { rows } = await db.query('SELECT id FROM programs WHERE tenant_id = $1', [req.auth.tenantId])
    for (const row of rows) wallet.notifyProgram(row.id)
  }

  r.put('/logo', requireRole('manager'), async (req, res) => {
    const { png } = parse(body, req.body)
    const buf = Buffer.from(png.replace(/^data:image\/png;base64,/, ''), 'base64')
    if (buf.length > MAX_LOGO_BYTES) throw new HttpError(413, 'logo_too_large')
    if (!inspectLogo(buf)) throw new HttpError(422, 'invalid_logo')
    const {
      rows: [row],
    } = await db.query('UPDATE tenants SET logo = $2, logo_version = extract(epoch from now())::int WHERE id = $1 RETURNING slug, logo_version', [
      req.auth.tenantId,
      buf,
    ])
    await audit(db, req, 'branding.logo_set', null, { bytes: buf.length })
    await refreshPasses(req)
    res.json({ logoUrl: `/api/public/logo/${row.slug}?v=${row.logo_version}` })
  })

  r.delete('/logo', requireRole('manager'), async (req, res) => {
    await db.query('UPDATE tenants SET logo = NULL, logo_version = 0 WHERE id = $1', [req.auth.tenantId])
    await audit(db, req, 'branding.logo_removed', null)
    await refreshPasses(req)
    res.json({ logoUrl: null })
  })

  return r
}
