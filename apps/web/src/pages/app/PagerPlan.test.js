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
  includedTier: 'basic',
  upgrade: 'plus',
  withLoyaltyPrice: true,
  prices: { plus: { monthly: 2500, yearly: 25000 } },
  trialAvailable: false,
  purchasable: true,
  subscription: { tier: 'basic', branches: 50, status: 'active', source: 'loyalty', active: true, expiresAt: '2027-06-01T00:00:00Z' },
}
const render = (data) => {
  state.data = data
  return renderToString(createElement(I18nProvider, null, createElement(MemoryRouter, null, createElement(PagerPlan, { checkoutHost: 'billing.example' }))))
}

describe('in-app pager plan page', () => {
  it('paid Loyalty: Basic included, the way to the Pager tab, and ONE Plus upgrade card at 25 / 250; no trial, no Basic price', () => {
    const html = render(included)
    expect(html).toContain('البيجر الأساسي مشمول في اشتراكك في مرقام ولاء')
    expect(html).toContain('href="/app/pager"')
    expect(html).toContain('بلس — 25 ر.س / فرع / شهر أو 250 ر.س / سنة')
    expect(html.split('رقِّ إلى بلس').length - 1).toBe(1)
    expect(html).not.toContain('29 ر.س')
    expect(html).not.toContain('15 ر.س')
    expect(html).not.toContain('ابدأ التجربة')
  })

  it('paid Loyalty with Plus bought: the Plus subscription at the Loyalty price, Basic stays included, no upgrade card', () => {
    const html = render({
      ...included,
      upgrade: null,
      purchasable: false,
      subscription: {
        tier: 'plus',
        cycle: 'monthly',
        branches: 2,
        status: 'active',
        source: 'billing',
        active: true,
        withLoyaltyPrice: true,
        expiresAt: '2027-01-01T00:00:00Z',
      },
    })
    expect(html).toContain('بسعر مشتركي مرقام ولاء')
    expect(html).toContain('الأساسي يبقى مشمولاً')
    expect(html).not.toContain('رقِّ إلى بلس')
  })

  it('Loyalty lapsed with Plus at the Loyalty price: the standalone price is shown before any renewal', () => {
    const html = render({
      ...standalone,
      trialAvailable: false,
      renewsAtStandalone: { tier: 'plus', until: '2027-01-01T00:00:00Z', monthly: 4900, yearly: 49000 },
      subscription: {
        tier: 'plus',
        cycle: 'monthly',
        branches: 1,
        status: 'active',
        source: 'billing',
        active: true,
        withLoyaltyPrice: true,
        expiresAt: '2027-01-01T00:00:00Z',
      },
    })
    expect(html).toContain('49 ر.س / فرع / شهر أو 490 ر.س / سنة')
    expect(html).toContain('لن يتجدد بسعر مشتركي الولاء')
  })

  it('Loyalty lapsed, Plus scheduled to renew at the standalone price: the new price and date are shown before the charge', () => {
    const sub = {
      tier: 'plus',
      cycle: 'yearly',
      branches: 1,
      status: 'active',
      source: 'billing',
      active: true,
      withLoyaltyPrice: true,
      expiresAt: '2027-01-01T00:00:00Z',
    }
    const html = render({
      ...standalone,
      trialAvailable: false,
      renewsAtStandalone: { tier: 'plus', until: '2027-01-01T00:00:00Z', cycle: 'yearly', scheduled: true, monthly: 4900, yearly: 49000 },
      subscription: sub,
    })
    expect(html).toContain('ثم يتجدد تلقائياً بسعر 490 ر.س / فرع / سنة')
    expect(html).not.toContain('لن يتجدد بسعر مشتركي الولاء')
  })

  it('paid Loyalty with a standalone Basic still running: no Plus upgrade card, the date it ends and that Plus comes after', () => {
    const html = render({
      ...included,
      upgrade: null,
      purchasable: false,
      basicRunning: { tier: 'basic', until: '2027-01-01T00:00:00Z' },
      subscription: {
        ...included.subscription,
        replacedSubscription: { tier: 'basic', cycle: 'monthly', expiresAt: '2027-01-01T00:00:00Z', renewalStopped: true },
      },
    })
    expect(html).toContain('باقة البيجر الأساسية الحالية تنتهي في')
    expect(html).toContain('بعدها تقدر ترقّي إلى بلس')
    expect(html).not.toContain('رقِّ إلى بلس')
  })

  it('standalone: the yearly switch, the list prices, Basic included with Loyalty and the Plus Loyalty price', () => {
    const html = render(standalone)
    expect(html).toContain('السنوي بسعر عشرة أشهر')
    expect(html).toContain('سنوي')
    expect(html).toContain('29 ر.س')
    // No Basic with-Loyalty price (15) any more; Basic says it is included, Plus says its Loyalty price.
    expect(html).not.toContain('15 ر.س')
    expect(html).toContain('مشمول مع أي اشتراك مدفوع في مرقام ولاء')
    expect(html).toContain('مع مرقام ولاء: 25 ر.س / فرع / شهر')
  })
})
