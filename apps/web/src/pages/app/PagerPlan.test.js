import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '../../i18n/index.jsx'

// The plan data the page shows, per test (GET /billing/pager).
const state = vi.hoisted(() => ({ data: null }))
vi.mock('../../lib/api.js', () => ({
  api: async () => ({}),
  useApi: () => ({ data: state.data, loading: false, error: null, reload: () => {} }),
}))
const { default: PagerPlan } = await import('./PagerPlan.jsx')

const standalone = {
  included: false,
  cycles: ['monthly', 'yearly'],
  prices: { basic: { monthly: 2900, yearly: 29000 }, plus: { monthly: 4900, yearly: 49000 } },
  currency: 'SAR',
  vatExcluded: true,
  trialDays: 14,
  maxBranches: 50,
  trialAvailable: true,
  purchasable: true,
  subscription: null,
}
const included = {
  ...standalone,
  included: true,
  trialAvailable: false,
  purchasable: false,
  subscription: { tier: 'plus', branches: 50, status: 'active', source: 'loyalty', active: true, expiresAt: '2027-06-01T00:00:00Z' },
}
const render = (data) => {
  state.data = data
  return renderToString(createElement(I18nProvider, null, createElement(MemoryRouter, null, createElement(PagerPlan, { checkoutHost: 'billing.example' }))))
}

describe('in-app pager plan page', () => {
  it('included with paid Loyalty: one "included" card and the way to the Pager tab; no prices, trial or checkout', () => {
    const html = render(included)
    expect(html).toContain('مشمول في اشتراكك في مرقام ولاء')
    expect(html).toContain('href="/app/pager"')
    expect(html).not.toContain('ر.س')
    expect(html).not.toContain('ابدأ التجربة')
    expect(html).not.toContain('>اشترك<')
  })

  it('standalone: the yearly switch, the list prices and the confirmed yearly rule (290 = 10 × 29)', () => {
    const html = render(standalone)
    expect(html).toContain('السنوي بسعر عشرة أشهر')
    expect(html).toContain('سنوي')
    expect(html).toContain('29 ر.س')
    // The old with-Loyalty price line is gone; the inclusion is stated without a price.
    expect(html).not.toContain('15 ر.س')
    expect(html).toContain('مشمول مع أي اشتراك مدفوع في مرقام ولاء')
  })
})
