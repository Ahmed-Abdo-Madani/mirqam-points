import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '../i18n/index.jsx'

// The session the page sees, per test; Navigate is rendered as a marker so the target can be read.
const session = vi.hoisted(() => ({ value: { status: 'anon', me: null } }))
vi.mock('../lib/session.jsx', () => ({ useSession: () => session.value }))
vi.mock('../lib/platform.js', () => ({ PURCHASES_IN_APP: true, REGISTRATION_IN_APP: true }))
vi.mock('../lib/api.js', () => ({ api: async () => ({}), useApi: () => ({ data: null }), NATIVE: false }))
vi.mock('../components/AppShell.jsx', () => ({ LocaleToggle: () => null }))
vi.mock('react-router-dom', async (importOriginal) => {
  const real = await importOriginal()
  return { ...real, Navigate: ({ to }) => createElement('a', { 'data-navigate': to }) }
})
const { default: Auth } = await import('./Auth.jsx')

const render = (url, mode = 'register') =>
  renderToString(
    createElement(
      I18nProvider,
      null,
      createElement(
        MemoryRouter,
        { initialEntries: [url] },
        createElement(Routes, null, createElement(Route, { path: '*', element: createElement(Auth, { mode }) })),
      ),
    ),
  )

describe('the sign-up / sign-in page', () => {
  it('?product=pager: Mirqam Pager headings and panel, not the loyalty card', () => {
    session.value = { status: 'anon', me: null }
    const html = render('/register?product=pager')
    expect(html).toContain('أنشئ حسابك في بيجر مرقام')
    expect(html).toContain('MIRQAM PAGER')
    expect(html).not.toContain('LOYALTY &amp; GIFT CARDS')
    expect(render('/login?product=pager', 'login')).toContain('سجّل الدخول إلى بيجر مرقام')
  })

  it('without product: the loyalty page as before', () => {
    session.value = { status: 'anon', me: null }
    const html = render('/register')
    expect(html).toContain('أنشئ حساب متجرك')
    expect(html).toContain('LOYALTY &amp; GIFT CARDS')
  })

  it('a signed-in owner opening the pager link goes straight to the pager page; an explicit next wins', () => {
    session.value = { status: 'auth', me: { role: 'owner' } }
    expect(render('/register?product=pager')).toContain('data-navigate="/app/pager"')
    expect(render('/login?product=pager&next=/app/members', 'login')).toContain('data-navigate="/app/members"')
    expect(render('/login?next=//evil.example', 'login')).toContain('data-navigate="/app"')
  })
})
