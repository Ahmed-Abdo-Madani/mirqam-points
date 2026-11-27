import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '../../i18n/index.jsx'

// The plan data the page shows, per test (GET /billing/pager).
const state = vi.hoisted(() => ({ data: null }))
vi.mock('../../lib/api.js', () => ({
  api: async () => ({}),
  useApi: () => ({ data: state.data, loading: false, error: null, reload: () => {} }),
}))
const { default: PagerPlan } = await import('./PagerPlan.jsx')

const offers = (withLoyalty) => ({
  withLoyalty,
  cycles: withLoyalty ? ['monthly'] : ['monthly', 'yearly'],
  prices: withLoyalty
    ? { basic: { monthly: 1500, yearly: null }, plus: { monthly: 2500, yearly: null } }
    : { basic: { monthly: 2900, yearly: 29000 }, plus: { monthly: 4900, yearly: 49000 } },
  currency: 'SAR',
  vatExcluded: true,
  trialDays: 14,
  maxBranches: 50,
  trialAvailable: true,
  purchasable: true,
  subscription: null,
})
const render = (data) => {
  state.data = data
  return renderToString(createElement(I18nProvider, null, createElement(PagerPlan, { checkoutHost: 'billing.example' })))
}

describe('in-app pager plan page', () => {
  it('with the Loyalty price: no yearly rule and no yearly switch', () => {
    const html = render(offers(true))
    expect(html).not.toContain('عشرة أشهر')
    expect(html).not.toContain('سنوي')
    expect(html).toContain('سعر مشتركي مرقام ولاء شهري حالياً.')
    expect(html).toContain('15 ر.س')
  })

  it('at the list price: the yearly switch and its confirmed rule (290 = 10 × 29) stay', () => {
    const html = render(offers(false))
    expect(html).toContain('السنوي بسعر عشرة أشهر')
    expect(html).toContain('سنوي')
  })
})
