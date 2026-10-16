import { existsSync } from 'node:fs'
import { join } from 'node:path'
import express from 'express'
import helmet from 'helmet'
import { bearerToken, loadSession, readCookie, requireAuth, SESSION_COOKIE } from './auth.js'
import { createBilling } from './billing.js'
import { installHqAdmin } from './hq-admin.js'
import { errorHandler, HttpError } from './http.js'
import authRoutes from './routes/auth.js'
import billingRoutes from './routes/billing.js'
import brandingRoutes from './routes/branding.js'
import campaignRoutes from './routes/campaigns.js'
import giftCardRoutes from './routes/giftcards.js'
import ledgerRoutes from './routes/ledger.js'
import memberRoutes from './routes/members.js'
import programRoutes from './routes/programs.js'
import staffRoutes from './routes/staff.js'
import { appleWebService, publicRoutes } from './routes/wallet.js'
import { installSocialLogin } from './social-login.js'
import { createWallet } from './wallet/index.js'

export const VERSION = '0.2.0'
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

/* CSRF defence for cookie sessions: a cross-site form cannot send
   application/json without a CORS preflight, and any browser-supplied Origin
   must be ours. Bearer-token requests (native app) carry no ambient
   credentials, so they are not CSRF-able; the app's own webview origin is
   accepted for them and for its sign-in calls. */
function csrfGuard(config) {
  return (req, _res, next) => {
    if (SAFE_METHODS.has(req.method)) return next()
    if (!req.is('application/json')) throw new HttpError(415, 'json_required')
    const origin = req.get('origin')
    if (!origin || config.allowedOrigins.has(origin) || origin === `${req.protocol}://${req.get('host')}`) return next()
    const nativeApp = config.mobileOrigins.has(origin) && !readCookie(req, SESSION_COOKIE) && (bearerToken(req) || req.get('x-mp-client') === 'mobile')
    if (nativeApp) return next()
    throw new HttpError(403, 'origin_not_allowed')
  }
}

/* CORS only for the native app's webview origins — never credentialed. */
function mobileCors(config) {
  return (req, res, next) => {
    const origin = req.get('origin')
    if (!origin || !config.mobileOrigins.has(origin)) return next()
    res.setHeader('Access-Control-Allow-Origin', origin)
    res.setHeader('Vary', 'Origin')
    res.setHeader('Access-Control-Allow-Headers', 'authorization, content-type, idempotency-key, x-mp-client')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS')
    res.setHeader('Access-Control-Max-Age', '600')
    if (req.method === 'OPTIONS') return res.sendStatus(204)
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

  // Permit GA4 only on public documents; authenticated routes retain the original CSP.
  app.use((req, res, next) => {
    if (req.path === '/' || /^\/blog\/[a-z0-9-]+\.html$/.test(req.path)) {
      const policy = String(res.getHeader('Content-Security-Policy') || '')
        .replace(/script-src ([^;]+)/, '$& https://www.googletagmanager.com')
        .replace(/connect-src ([^;]+)/, '$& https://www.googletagmanager.com https://*.google-analytics.com https://*.analytics.google.com')
        .replace(/img-src ([^;]+)/, '$& https://www.googletagmanager.com https://*.google-analytics.com')
      res.setHeader('Content-Security-Policy', policy)
    }
    next()
  })

  // Consented marketing SDKs are scoped to editorial HTML; account and API routes keep the strict policy.
  app.use((req, res, next) => {
    if (/^\/blog\/[a-z0-9-]+\.html$/.test(req.path)) {
      const policy = String(res.getHeader('Content-Security-Policy') || '')
        .replace(
          /script-src ([^;]+)/,
          '$& https://www.clarity.ms https://scripts.clarity.ms https://analytics.tiktok.com https://anlytics-ipv6.tiktokw.us https://sc-static.net https://tr.snapchat.com https://connect.facebook.net',
        )
        .replace(
          /connect-src ([^;]+)/,
          '$& https://*.clarity.ms https://analytics.tiktok.com https://anlytics-ipv6.tiktokw.us https://sc-static.net https://tr.snapchat.com https://www.facebook.com',
        )
        .replace(
          /img-src ([^;]+)/,
          '$& https://*.clarity.ms https://c.bing.com https://analytics.tiktok.com https://anlytics-ipv6.tiktokw.us https://tr.snapchat.com https://www.facebook.com',
        )
      res.setHeader('Content-Security-Policy', policy)
    }
    next()
  })

  app.get('/api/health', async (_req, res) => {
    try {
      await db.query('SELECT 1')
      res.json({ ok: true, version: VERSION, db: db.kind })
    } catch {
      res.status(503).json({ ok: false, error: 'db_unavailable' })
    }
  })

  const wallet = createWallet({ db, config })
  // Apple Wallet devices call this directly and authenticate with per-pass tokens.
  app.use('/api/wallet/apple', appleWebService({ db, config, wallet }))

  // Logo uploads carry a base64 PNG, so they get a larger body limit than the rest of the API.
  app.use('/api/branding', mobileCors(config), express.json({ limit: '600kb' }), csrfGuard(config), loadSession(db), brandingRoutes({ db, wallet }))
  installSocialLogin(app, { db, config })
  app.use('/api', mobileCors(config), express.json({ limit: '64kb' }), csrfGuard(config), loadSession(db))
  installHqAdmin(app, { db, config, wallet })
  app.use('/api/public', publicRoutes({ db, wallet }))
  app.get('/api/wallet/status', requireAuth, (_req, res) => res.json(wallet.status()))
  app.locals.billing = createBilling({ db, config })
  app.use('/api/billing', billingRoutes(app.locals.billing))
  app.use('/api/auth', authRoutes({ db, config }))
  app.use('/api/programs', programRoutes({ db, wallet }))
  app.use('/api/members', memberRoutes({ db, wallet }))
  app.use('/api/ledger', ledgerRoutes({ db, wallet }))
  app.use('/api/campaigns', campaignRoutes({ db, wallet }))
  app.use('/api/gift-cards', giftCardRoutes({ db, config, wallet }))
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
