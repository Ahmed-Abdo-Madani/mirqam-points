import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')

export function loadConfig(env = process.env) {
  const production = env.NODE_ENV === 'production'
  const databaseUrl = env.DATABASE_URL || (production ? '' : `pglite://${join(ROOT, '.data', 'pg')}`)
  if (!databaseUrl) throw new Error('DATABASE_URL is required in production')
  const publicUrl = (env.PUBLIC_URL || 'http://localhost:5174').replace(/\/$/, '')
  return {
    production,
    moyasarSecretKey: env.MOYASAR_SECRET_KEY || '',
    // Unified billing (mirqam-billing). When BILLING_URL is set it replaces the direct Moyasar flow.
    billingUrl: env.BILLING_URL || '',
    billingApiKey: env.BILLING_API_KEY || '',
    billingWebhookSecret: env.BILLING_WEBHOOK_SECRET || '',
    // Optional: the secret_token configured on the Moyasar webhook; when set, webhooks without it are refused.
    moyasarWebhookSecret: env.MOYASAR_WEBHOOK_SECRET || '',
    // Transactional email (Resend). Without a key subscription emails are skipped; events still show in-app.
    resendApiKey: env.RESEND_API_KEY || '',
    emailFrom: env.EMAIL_FROM_ADDRESS || 'Mirqam <no-reply@mirqam.sa>',
    // Paywall: off unless BILLING_ENFORCE=1. Workspaces that never subscribed get BILLING_TRIAL_DAYS of access.
    billingEnforce: env.BILLING_ENFORCE === '1',
    trialDays: Number(env.BILLING_TRIAL_DAYS || 14),
    lifecycleIntervalMs: Number(env.BILLING_LIFECYCLE_INTERVAL_MS || 3_600_000),
    port: Number(env.PORT || 4100),
    databaseUrl,
    publicUrl,
    // Origins allowed to make state-changing requests with the session cookie.
    allowedOrigins: new Set([
      publicUrl,
      ...(env.EXTRA_ORIGINS || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    ]),
    sessionTtlDays: Number(env.SESSION_TTL_DAYS || 30),
    authRateLimit: Number(env.AUTH_RATE_LIMIT || 20),
    webDist: env.WEB_DIST || join(ROOT, 'apps', 'web', 'dist'),
    trustProxy: env.TRUST_PROXY ? Number(env.TRUST_PROXY) : production ? 1 : 0,
    // Native app webviews (Capacitor) call the API cross-origin with bearer tokens.
    mobileOrigins: new Set((env.MOBILE_ORIGINS || 'capacitor://localhost,https://localhost,http://localhost').split(',').map((s) => s.trim())),
    // AES-256-GCM key material for secrets at rest (gift-card codes). Required in production for gift cards.
    secretKey: env.SECRET_KEY || (production ? '' : 'development-only-secret-key'),
    google: {
      issuerId: env.GOOGLE_WALLET_ISSUER_ID || '',
      // Service-account key JSON (raw or base64). Absent = Google Wallet disabled.
      serviceAccount: parseServiceAccount(env.GOOGLE_WALLET_SA_JSON),
    },
    apple: {
      passTypeId: env.APPLE_PASS_TYPE_ID || '',
      teamId: env.APPLE_TEAM_ID || '',
      certPem: pem(env.APPLE_PASS_CERT_PEM),
      keyPem: pem(env.APPLE_PASS_KEY_PEM),
      keyPassphrase: env.APPLE_PASS_KEY_PASSPHRASE || '',
      wwdrPem: pem(env.APPLE_WWDR_PEM),
      apnsHost: env.APPLE_APNS_HOST || 'https://api.push.apple.com',
    },
  }
}

/* Env vars cannot hold newlines everywhere; accept PEM raw, with literal \n, or base64. */
function pem(value) {
  if (!value) return ''
  const v = value.includes('-----BEGIN') ? value : Buffer.from(value, 'base64').toString('utf8')
  return v.replace(/\\n/g, '\n')
}

function parseServiceAccount(value) {
  if (!value) return null
  try {
    const json = JSON.parse(value.trim().startsWith('{') ? value : Buffer.from(value, 'base64').toString('utf8'))
    return json.client_email && json.private_key ? json : null
  } catch {
    console.error('[config] GOOGLE_WALLET_SA_JSON is not valid service-account JSON — Google Wallet disabled')
    return null
  }
}
