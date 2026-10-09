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
  }
}
