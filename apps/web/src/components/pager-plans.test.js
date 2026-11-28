import { PAGER_PLANS } from '@mirqam-points/shared'
import { describe, expect, it } from 'vitest'
import ar from '../i18n/ar.js'
import en from '../i18n/en.js'
import { translate } from '../i18n/index.jsx'
import { cycleChoice } from './PagerPlans.jsx'

describe('Plus card: the WhatsApp line', () => {
  it('names no monthly limit and never says unlimited (there is no limit, owner 2026-11-27)', () => {
    expect(PAGER_PLANS.plus).not.toHaveProperty('whatsappFairUse')
    expect(translate('ar', 'pager.features.whatsappReady')).toBe('رسالة «طلبك جاهز» على واتساب')
    expect(translate('en', 'pager.features.whatsappReady')).toBe('“Your order is ready” on WhatsApp')
  })

  it('no pager copy in either language names a message count per month', () => {
    for (const dict of [ar, en]) {
      const text = JSON.stringify(dict.pager)
      expect(text).not.toMatch(/\d[\d,]*\s*(messages|رسالة)|messages a month|رسالة شهري/i)
    }
  })
})

describe('the cycle switch in the app', () => {
  it('monthly and yearly are both sold (standalone)', () => {
    expect(cycleChoice(['monthly', 'yearly'], 'yearly')).toEqual({ offered: ['monthly', 'yearly'], shown: 'yearly', switchable: true })
    expect(cycleChoice(undefined, 'monthly')).toMatchObject({ shown: 'monthly', switchable: true })
  })

  it('the cards say the pager is included with paid Loyalty, with no price, in Arabic and English', () => {
    expect(translate('ar', 'pager.includedWithLoyalty')).toBe('مشمول مع أي اشتراك مدفوع في مرقام ولاء')
    expect(translate('en', 'pager.includedWithLoyalty')).toBe('Included with any paid Mirqam Loyalty plan')
    for (const l of ['ar', 'en']) expect(translate(l, 'pager.includedWithLoyalty')).not.toMatch(/\d/)
  })
})
