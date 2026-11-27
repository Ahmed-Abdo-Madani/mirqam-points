import { describe, expect, it } from 'vitest'
import { translate } from '../i18n/index.jsx'
import { authLanding, authProduct, forgetLanding, PAGER_LANDING, rememberLanding, takeLanding } from './auth-landing.js'

const q = (s) => new URLSearchParams(s)

function memoryStorage() {
  const m = new Map()
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), m }
}

describe('where a sign-up or sign-in lands', () => {
  it('product=pager lands on the pager page (register and login use the same rule)', () => {
    expect(authLanding(q('product=pager'))).toBe('/app/pager')
    expect(PAGER_LANDING).toBe('/app/pager')
  })

  it('a valid next always wins, also over product=pager', () => {
    expect(authLanding(q('next=/app/members&product=pager'))).toBe('/app/members')
    expect(authLanding(q('next=/app/billing'))).toBe('/app/billing')
  })

  it('an invalid next falls back as today (or to the pager plan with product=pager)', () => {
    for (const bad of ['https://evil.example/app', '//evil.example/app', '/login', 'javascript:alert(1)', ''])
      expect(authLanding(q(`next=${encodeURIComponent(bad)}`))).toBe('/app')
    expect(authLanding(q('next=//evil.example&product=pager'))).toBe(PAGER_LANDING)
  })

  it('any other product value is ignored', () => {
    for (const p of ['Pager', 'loyalty', 'pager ', 'pos', '']) {
      expect(authProduct(q(`product=${encodeURIComponent(p)}`))).toBeNull()
      expect(authLanding(q(`product=${encodeURIComponent(p)}`))).toBe('/app')
    }
    expect(authLanding(q(''))).toBe('/app')
  })

  it('social sign-in: the landing survives the provider round trip once, and only safe values are kept', () => {
    const s = memoryStorage()
    rememberLanding(PAGER_LANDING, s)
    expect(takeLanding(s)).toBe(PAGER_LANDING)
    expect(takeLanding(s)).toBeNull()
    rememberLanding('/app', s)
    expect(s.m.size).toBe(0)
    s.setItem('mirqam-auth-landing', 'https://evil.example')
    expect(takeLanding(s)).toBeNull()
    s.setItem('mirqam-auth-landing', JSON.stringify({ to: 'https://evil.example', at: Date.now() }))
    expect(takeLanding(s)).toBeNull()
    expect(s.m.size).toBe(0)
  })

  it('a stale landing never outlives its attempt: forgotten when the sign-in page opens again, and expires', () => {
    const s = memoryStorage()
    rememberLanding(PAGER_LANDING, s)
    forgetLanding(s)
    expect(takeLanding(s)).toBeNull()
    rememberLanding(PAGER_LANDING, s, 1_000)
    expect(takeLanding(s, 1_000 + 11 * 60_000)).toBeNull()
  })
})

describe('pager sign-up copy', () => {
  it('says Mirqam Pager and the trial, in Arabic and English', () => {
    const vars = { days: 14 }
    expect(translate('ar', 'auth.pager.registerTitle', vars)).toContain('بيجر مرقام')
    expect(translate('ar', 'auth.pager.registerSubtitle', vars)).toContain('14')
    expect(translate('ar', 'auth.pager.loginTitle', vars)).toContain('بيجر مرقام')
    expect(translate('en', 'auth.pager.registerTitle', vars)).toContain('Mirqam Pager')
    expect(translate('en', 'auth.pager.registerSubtitle', vars)).toContain('14-day free trial')
    expect(translate('en', 'auth.pager.loginTitle', vars)).toContain('Mirqam Pager')
    // The side panel speaks about the pager (which runs in Mirqam Loyalty), not loyalty programmes,
    // and never sends anyone to the Cashier app.
    for (const k of ['panelTitle', 'panel1', 'panel2', 'panel3', 'loginSubtitle']) {
      expect(translate('en', `auth.pager.${k}`, vars)).not.toMatch(/loyalty program|cashier/i)
      expect(translate('ar', `auth.pager.${k}`, vars)).not.toMatch(/برامج الولاء|كاشير/)
    }
  })
})
