/* Earn rules — pure functions so the console can preview exactly what the
   server will post. Money is always integer halalas (minor units); points and
   stamps are always integers. No floats cross this boundary. */

export const PROGRAM_TYPES = ['points', 'stamps']

export const DEFAULT_CONFIG = {
  points: { pointsPerUnit: 1, unitMinor: 100, minPurchaseMinor: 0, maxPointsPerTxn: null },
  stamps: { stampsPerVisit: 1, stampsRequired: 10, minPurchaseMinor: 0 },
}

const isInt = (v) => Number.isSafeInteger(v)

/** Validates a program config. Returns { ok: true, config } or { ok: false, error }. */
export function validateProgramConfig(type, raw = {}) {
  if (!PROGRAM_TYPES.includes(type)) return { ok: false, error: 'invalid_program_type' }
  const config = { ...DEFAULT_CONFIG[type], ...raw }
  if (type === 'points') {
    const { pointsPerUnit, unitMinor, minPurchaseMinor, maxPointsPerTxn } = config
    if (!isInt(pointsPerUnit) || pointsPerUnit < 1 || pointsPerUnit > 1000) return { ok: false, error: 'invalid_points_per_unit' }
    if (!isInt(unitMinor) || unitMinor < 1 || unitMinor > 10_000_000) return { ok: false, error: 'invalid_unit' }
    if (!isInt(minPurchaseMinor) || minPurchaseMinor < 0) return { ok: false, error: 'invalid_min_purchase' }
    if (maxPointsPerTxn !== null && (!isInt(maxPointsPerTxn) || maxPointsPerTxn < 1)) return { ok: false, error: 'invalid_max_points' }
    return { ok: true, config: { pointsPerUnit, unitMinor, minPurchaseMinor, maxPointsPerTxn } }
  }
  const { stampsPerVisit, stampsRequired, minPurchaseMinor } = config
  if (!isInt(stampsPerVisit) || stampsPerVisit < 1 || stampsPerVisit > 20) return { ok: false, error: 'invalid_stamps_per_visit' }
  if (!isInt(stampsRequired) || stampsRequired < 2 || stampsRequired > 50) return { ok: false, error: 'invalid_stamps_required' }
  if (!isInt(minPurchaseMinor) || minPurchaseMinor < 0) return { ok: false, error: 'invalid_min_purchase' }
  return { ok: true, config: { stampsPerVisit, stampsRequired, minPurchaseMinor } }
}

/**
 * How much a purchase earns under a program.
 * points: floor(purchase / unit) * pointsPerUnit, capped by maxPointsPerTxn.
 * stamps: stampsPerVisit per qualifying visit, independent of amount.
 */
export function computeEarn(type, config, purchaseMinor) {
  if (!isInt(purchaseMinor) || purchaseMinor < 0) return 0
  if (purchaseMinor < (config.minPurchaseMinor || 0)) return 0
  if (type === 'stamps') return config.stampsPerVisit
  const raw = Math.floor(purchaseMinor / config.unitMinor) * config.pointsPerUnit
  return config.maxPointsPerTxn ? Math.min(raw, config.maxPointsPerTxn) : raw
}

/** SAR string ("12.50") → halalas (1250). Returns null for anything that is not a non-negative amount with ≤2 decimals. */
export function parseMoneyToMinor(input) {
  if (input == null) return null
  const s = String(input)
    .trim()
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x660))
    .replace('٫', '.')
    .replace(/,/g, '')
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(s)) return null
  const [whole, frac = ''] = s.split('.')
  return Number(whole) * 100 + Number(frac.padEnd(2, '0'))
}

export function formatMinor(minor) {
  const sign = minor < 0 ? '-' : ''
  const abs = Math.abs(minor)
  return `${sign}${Math.floor(abs / 100).toLocaleString('en-US')}.${String(abs % 100).padStart(2, '0')}`
}
