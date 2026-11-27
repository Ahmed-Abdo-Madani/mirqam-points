import { PAGER_PLANS, PAGER_WHATSAPP_FAIR_USE, pagerFeatureKey } from '@mirqam-points/shared'
import { describe, expect, it } from 'vitest'
import { translate } from '../i18n/index.jsx'
import { cycleChoice } from './PagerPlans.jsx'

const line = (locale, plan) =>
  translate(locale, `pager.features.${pagerFeatureKey(plan, 'whatsappReady')}`, { n: plan.whatsappFairUse?.toLocaleString('en-US') })

describe('Plus card: the WhatsApp line', () => {
  it('names no number while the owner has not set a limit, and never says unlimited', () => {
    expect(PAGER_WHATSAPP_FAIR_USE).toBeNull()
    expect(line('ar', PAGER_PLANS.plus)).toBe('رسالة «طلبك جاهز» على واتساب')
    expect(line('en', PAGER_PLANS.plus)).toBe('“Your order is ready” on WhatsApp')
    for (const l of ['ar', 'en']) expect(line(l, PAGER_PLANS.plus)).not.toMatch(/\d|unlimited|بلا حد|غير محدود/i)
  })

  it('the limit wording comes back by itself when a number is set', () => {
    const withLimit = { ...PAGER_PLANS.plus, whatsappFairUse: 1000 }
    expect(line('ar', withLimit)).toBe('رسالة «طلبك جاهز» على واتساب (حتى 1,000 رسالة شهرياً لكل فرع)')
    expect(line('en', withLimit)).toBe('“Your order is ready” on WhatsApp (up to 1,000 messages a month per branch)')
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
