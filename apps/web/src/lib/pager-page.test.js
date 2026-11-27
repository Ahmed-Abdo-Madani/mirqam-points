import { describe, expect, it } from 'vitest'
import { translate } from '../i18n/index.jsx'
import { canEditBusiness, counterColumns, pagerPageState, phoneTabs, pickBranch } from './pager-page.js'

describe('the /app/pager page states', () => {
  it('no plan: the explanation, the trial and the prices', () => {
    expect(pagerPageState({ data: { status: 'no_plan', plan: { trialAvailable: true } } })).toBe('no_plan')
    expect(pagerPageState({ error: { code: 'pager_no_plan' } })).toBe('no_plan')
  })

  it('trial or paid plan: the live counter (a trial is a live plan)', () => {
    expect(pagerPageState({ data: { status: 'live', subscription: { status: 'trialing', active: true }, branches: [] } })).toBe('live')
    expect(pagerPageState({ data: { status: 'starting' } })).toBe('starting')
  })

  it('POS unreachable, or anything unexpected: the plain message and a retry, never a blank page', () => {
    expect(pagerPageState({ error: { code: 'pager_unavailable', status: 503 } })).toBe('unavailable')
    expect(pagerPageState({ error: { code: 'network' } })).toBe('unavailable')
    expect(pagerPageState({ data: { status: 'something-else' } })).toBe('unavailable')
    expect(pagerPageState({ loading: true })).toBe('loading')
  })

  it('the copy for each state exists in Arabic and English and never sends anyone to the Cashier app', () => {
    for (const locale of ['ar', 'en']) {
      for (const k of ['noPlan', 'starting', 'unavailable', 'retry', 'newNumber', 'call', 'recall', 'done', 'askOwner', 'notOnYet']) {
        const text = translate(locale, `pager.page.${k}`)
        expect(text, `${locale} ${k}`).not.toBe(`pager.page.${k}`)
        expect(text).not.toMatch(/كاشير|cashier|pos\.mirqam/i)
      }
      expect(translate(locale, 'nav.pager')).toBe(locale === 'ar' ? 'البيجر' : 'Pager')
    }
  })
})

describe('the counter', () => {
  const t = (id, status, createdAt, readyAt) => ({ id, status, createdAt, readyAt })
  it('waiting oldest first, ready most recently called first', () => {
    const c = counterColumns([
      t('a', 'WAITING', '2026-11-27T10:05:00Z'),
      t('b', 'WAITING', '2026-11-27T10:01:00Z'),
      t('c', 'READY', '2026-11-27T09:00:00Z', '2026-11-27T10:02:00Z'),
      t('d', 'READY', '2026-11-27T09:00:00Z', '2026-11-27T10:04:00Z'),
      t('e', 'COLLECTED', '2026-11-27T09:00:00Z'),
    ])
    expect(c.waiting.map((x) => x.id)).toEqual(['b', 'a'])
    expect(c.ready.map((x) => x.id)).toEqual(['d', 'c'])
    expect(c.done.map((x) => x.id)).toEqual(['e'])
  })

  it('keeps the branch picked before, else the first one in the plan', () => {
    const branches = [
      { id: 'x', active: true, inPlan: false },
      { id: 'y', active: true, inPlan: true },
      { id: 'z', active: true, inPlan: true },
    ]
    expect(pickBranch(branches, 'z')).toBe('z')
    expect(pickBranch(branches, 'x')).toBe('y')
    expect(pickBranch(branches, null)).toBe('y')
    expect(pickBranch([], null)).toBeNull()
  })
})

describe('a real POS business (managed in Mirqam POS)', () => {
  it('branches and brand cannot be changed here; a business the plan made can', () => {
    expect(canEditBusiness({ managedInPos: true })).toBe(false)
    expect(canEditBusiness({ managedInPos: false })).toBe(true)
    expect(canEditBusiness({})).toBe(true)
  })
  it('says so plainly in Arabic and English', () => {
    expect(translate('ar', 'pager.page.managedInPos')).toContain('مرقام محاسبي')
    expect(translate('en', 'pager.page.managedInPos')).toContain('Mirqam POS')
    expect(translate('ar', 'errors.managed_in_pos')).toContain('مرقام محاسبي')
  })
  it('the counter says the link was opened (a preview can open it too), not that the customer saw it', () => {
    expect(translate('ar', 'pager.page.opened')).toBe('فتح الرابط')
    expect(translate('en', 'pager.page.opened')).toBe('Link opened')
  })
})

describe('phone tabs: the counter is one tap away', () => {
  it('pager and no loyalty programme: the centre button is the pager', () => {
    expect(phoneTabs({ pagerLive: true, hasProgram: false, canTransact: true })).toEqual(['home', 'pager', 'settings'])
  })
  it('pager and a programme: Home, Scan, Pager, Settings', () => {
    expect(phoneTabs({ pagerLive: true, hasProgram: true, canTransact: true })).toEqual(['home', 'scan', 'pager', 'settings'])
  })
  it('no pager: as before', () => {
    expect(phoneTabs({ pagerLive: false, hasProgram: true, canTransact: true })).toEqual(['home', 'scan', 'settings'])
    expect(phoneTabs({ pagerLive: true, hasProgram: true, canTransact: false })).toEqual(['home', 'settings'])
  })
})
