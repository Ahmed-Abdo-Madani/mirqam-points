import { CompanyIdentity, Logo, ThemeToggle } from '@mirqam/ui'
import { Link } from 'react-router-dom'
import { useI18n } from '../i18n/index.jsx'
import { useSession } from '../lib/session.jsx'
import { LocaleToggle } from './AppShell.jsx'

export default function PublicShell({ children }) {
  const { t } = useI18n()
  const { status } = useSession()
  return (
    <div className="flex min-h-dvh flex-col">
      <a href="#main" className="sr-only z-[100] rounded-xl bg-primary px-4 py-2 text-on-primary focus:not-sr-only focus:fixed focus:start-4 focus:top-4">
        {t('common.skipToContent')}
      </a>
      <header className="mq-card sticky top-3 z-40 mx-3 mt-3 sm:mx-auto sm:w-[calc(100%-48px)] sm:max-w-[1240px]">
        <div className="flex min-h-[72px] items-center gap-3 px-4 sm:px-6">
          <Link to="/" className="me-auto" aria-label={t('brand.name')}>
            <Logo className="h-10 sm:h-12" label={t('brand.label')} sublabel="LOYALTY & GIFT CARDS" alt={t('brand.name')} />
          </Link>
          <a href="/blog/index.html" className="hidden text-sm font-semibold text-muted hover:text-accent sm:inline">
            {t('footer.blog')}
          </a>
          <LocaleToggle className="hidden sm:inline-flex" />
          <ThemeToggle labels={{ toDark: t('common.darkMode'), toLight: t('common.lightMode') }} />
          {status === 'auth' ? (
            <Link
              to="/app"
              className="inline-flex min-h-10 items-center rounded-[var(--radius-control)] bg-primary px-4 text-sm font-semibold text-on-primary hover:bg-primary-hover"
            >
              {t('landing.openConsole')}
            </Link>
          ) : (
            <>
              <Link to="/login" className="hidden px-2 text-sm font-semibold text-muted hover:text-ink sm:inline">
                {t('auth.login')}
              </Link>
              <Link
                to="/register"
                className="inline-flex min-h-10 items-center rounded-[var(--radius-control)] bg-primary px-4 text-sm font-semibold text-on-primary hover:bg-primary-hover"
              >
                {t('auth.startFree')}
              </Link>
            </>
          )}
        </div>
      </header>

      <main id="main" className="flex-1">
        {children}
      </main>

      <footer className="mt-16 border-t border-line">
        <div className="mx-auto grid max-w-[1240px] gap-8 px-6 py-10">
          <div className="flex flex-wrap items-center justify-between gap-6">
            <Logo className="h-10" label={t('brand.label')} sublabel="LOYALTY & GIFT CARDS" alt={t('brand.name')} />
            <nav aria-label={t('footer.family')} className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-muted">
              <span className="font-semibold text-ink">{t('footer.family')}</span>
              <a href="/blog/index.html" className="hover:text-accent">
                {t('footer.blog')}
              </a>
              <a href="https://bot.mirqam.sa" className="hover:text-accent">
                {t('footer.bot')}
              </a>
              <a href="https://marketing.mirqam.sa" className="hover:text-accent">
                {t('footer.marketing')}
              </a>
              <a href="https://mirqam.sa" className="hover:text-accent">
                mirqam.sa
              </a>
            </nav>
          </div>
          <CompanyIdentity />
          <p className="text-center text-xs text-muted">{t('footer.rights', { year: new Date().getFullYear() })}</p>
        </div>
      </footer>
    </div>
  )
}
