import { existsSync } from 'node:fs'
import { join } from 'node:path'
import express from 'express'
import helmet from 'helmet'
import { loadSession } from './auth.js'
import { errorHandler, HttpError } from './http.js'
import authRoutes from './routes/auth.js'
import ledgerRoutes from './routes/ledger.js'
import memberRoutes from './routes/members.js'
import programRoutes from './routes/programs.js'
import staffRoutes from './routes/staff.js'

export const VERSION = '0.1.0'
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

/* CSRF defence for cookie sessions: a cross-site form cannot send
   application/json without a CORS preflight (which we never grant), and any
   browser-supplied Origin must be ours. */
function csrfGuard(config) {
  return (req, _res, next) => {
    if (SAFE_METHODS.has(req.method)) return next()
    if (!req.is('application/json')) throw new HttpError(415, 'json_required')
    const origin = req.get('origin')
    if (origin && !config.allowedOrigins.has(origin) && origin !== `${req.protocol}://${req.get('host')}`) {
      throw new HttpError(403, 'origin_not_allowed')
    }
    next()
  }
}

export function createApp({ db, config }) {
  const app = express()
  app.disable('x-powered-by')
  app.set('trust proxy', config.trustProxy)
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          fontSrc: ["'self'", 'data:'],
          imgSrc: ["'self'", 'data:', 'blob:'],
          connectSrc: ["'self'"],
          frameAncestors: ["'none'"],
          formAction: ["'self'"],
          upgradeInsecureRequests: config.production ? [] : null,
        },
      },
      crossOriginEmbedderPolicy: false,
    }),
  )

  app.get('/api/health', async (_req, res) => {
    try {
      await db.query('SELECT 1')
      res.json({ ok: true, version: VERSION, db: db.kind })
    } catch {
      res.status(503).json({ ok: false, error: 'db_unavailable' })
    }
  })

  app.use('/api', express.json({ limit: '64kb' }), csrfGuard(config), loadSession(db))
  app.use('/api/auth', authRoutes({ db, config }))
  app.use('/api/programs', programRoutes({ db }))
  app.use('/api/members', memberRoutes({ db }))
  app.use('/api/ledger', ledgerRoutes({ db }))
  app.use('/api/staff', staffRoutes({ db }))
  app.use('/api', (_req, res) => res.status(404).json({ error: 'not_found' }))

  // Production: the API also serves the built console (one Render service, like the bot).
  if (existsSync(join(config.webDist, 'index.html'))) {
    app.use(express.static(config.webDist, { index: false, maxAge: '1h', setHeaders: immutableAssets }))
    app.get('/{*splat}', (_req, res) => res.sendFile(join(config.webDist, 'index.html')))
  }

  app.use(errorHandler)
  return app
}

function immutableAssets(res, path) {
  if (/[\\/]assets[\\/]/.test(path)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
}
