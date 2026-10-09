import { describe, expect, it } from 'vitest'
import { computeEarn, formatMinor, normalizePhone, parseMoneyToMinor, validateProgramConfig } from './index.js'

describe('normalizePhone', () => {
  it.each([
    ['0501234567', '+966501234567'],
    ['501234567', '+966501234567'],
    ['966501234567', '+966501234567'],
    ['00966501234567', '+966501234567'],
    ['+966 50 123 4567', '+966501234567'],
    ['٠٥٠١٢٣٤٥٦٧', '+966501234567'],
    ['+971501234567', '+971501234567'],
  ])('%s → %s', (input, expected) => expect(normalizePhone(input)).toBe(expected))

  it.each(['', 'abc', '12', '+96650123', '0112345678', null])('rejects %s', (input) => {
    expect(normalizePhone(input)).toBeNull()
  })
})

describe('earn rules', () => {
  it('points: floor per unit, respects minimum and cap', () => {
    const { config } = validateProgramConfig('points', { pointsPerUnit: 2, unitMinor: 1000, minPurchaseMinor: 500, maxPointsPerTxn: 50 })
    expect(computeEarn('points', config, 400)).toBe(0)
    expect(computeEarn('points', config, 1999)).toBe(2)
    expect(computeEarn('points', config, 2000)).toBe(4)
    expect(computeEarn('points', config, 1_000_000)).toBe(50)
  })

  it('stamps: fixed per qualifying visit', () => {
    const { config } = validateProgramConfig('stamps', { stampsPerVisit: 1, stampsRequired: 8, minPurchaseMinor: 1000 })
    expect(computeEarn('stamps', config, 999)).toBe(0)
    expect(computeEarn('stamps', config, 1000)).toBe(1)
  })

  it('rejects invalid configs and floats', () => {
    expect(validateProgramConfig('points', { pointsPerUnit: 1.5 }).ok).toBe(false)
    expect(validateProgramConfig('stamps', { stampsRequired: 1 }).ok).toBe(false)
    expect(validateProgramConfig('cashback', {}).ok).toBe(false)
    expect(computeEarn('points', validateProgramConfig('points').config, 10.5)).toBe(0)
  })
})

describe('money', () => {
  it.each([
    ['12', 1200],
    ['12.5', 1250],
    ['12.05', 1205],
    ['1,250.00', 125000],
    ['٤٥٫٥', 4550],
  ])('parses %s', (input, minor) => expect(parseMoneyToMinor(input)).toBe(minor))

  it.each(['-1', '1.234', 'ten', ''])('rejects %s', (input) => expect(parseMoneyToMinor(input)).toBeNull())

  it('formats minor units', () => expect(formatMinor(125005)).toBe('1,250.05'))
})
