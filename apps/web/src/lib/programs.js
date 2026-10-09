import { money, num } from './format.js'

export function ruleSummary(program, t, locale) {
  const c = program.config || {}
  if (program.type === 'stamps') {
    const base = t('programs.ruleStamps', { n: num(c.stampsPerVisit), required: num(c.stampsRequired) })
    return c.minPurchaseMinor ? `${base} · ${t('programs.minPurchaseShort', { amount: money(c.minPurchaseMinor, locale) })}` : base
  }
  const base = t('programs.rulePoints', { points: num(c.pointsPerUnit), amount: money(c.unitMinor, locale) })
  return c.minPurchaseMinor ? `${base} · ${t('programs.minPurchaseShort', { amount: money(c.minPurchaseMinor, locale) })}` : base
}

export const unitLabel = (type, t) => t(type === 'stamps' ? 'common.stamps' : 'common.points')

export const statusTone = { draft: 'gray', active: 'green', archived: 'amber' }
