/* Build-time HTML of the public pages (scripts/prerender-public.mjs), served by
   the API inside #root (apps/api/src/seo.js) so that crawlers which do not run
   JavaScript see the page, its single <h1> and its links. Rendered the way a
   first visit looks: Arabic, signed out, light theme. On start the app renders
   with createRoot, which replaces this markup; visitors who chose English never
   see it (styles.css hides [data-prerendered] under html[lang="en"]). */

import { ToastProvider } from '@mirqam/ui'
import { INDEXABLE_PAGES } from '@mirqam-points/shared'
import { renderToString } from 'react-dom/server'
import { StaticRouter } from 'react-router-dom/server'
import { I18nProvider } from './i18n/index.jsx'
import { SessionProvider } from './lib/session.jsx'
import Landing from './pages/Landing.jsx'
import DeleteAccount from './pages/public/DeleteAccount.jsx'
import Legal from './pages/public/Legal.jsx'

const ELEMENTS = {
  home: () => <Landing />,
  privacy: () => <Legal doc="privacy" />,
  terms: () => <Legal doc="terms" />,
  support: () => <Legal doc="support" />,
  deleteAccount: () => <DeleteAccount />,
}

/** Every public page: { page, path }. */
export const pages = Object.entries(INDEXABLE_PAGES).map(([path, page]) => ({ page, path }))

/** The markup of one public page, wrapped in <div data-prerendered>. */
export function renderPage(page) {
  const entry = pages.find((p) => p.page === page)
  if (!entry || !ELEMENTS[page]) throw new Error(`no public page "${page}"`)
  const html = renderToString(
    <I18nProvider>
      <SessionProvider>
        <ToastProvider>
          <StaticRouter location={entry.path}>{ELEMENTS[page]()}</StaticRouter>
        </ToastProvider>
      </SessionProvider>
    </I18nProvider>,
  )
  return `<div data-prerendered="">${html}</div>`
}
