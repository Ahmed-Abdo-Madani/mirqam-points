import { Logo, ThemeToggle } from '@mirqam/ui'
import { Link } from 'react-router-dom'
import { LocaleToggle } from '../../components/AppShell.jsx'
import { useI18n } from '../../i18n/index.jsx'

/** Minimal frame for customer-facing pages (card, gift, join): the merchant is the hero, Mirqam stays quiet. */
export default function PublicCardShell({ children }) {
  const { t } = useI18n()
  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col px-4 py-5">
      <div className="mb-6 flex items-center justify-end gap-2">
        <LocaleToggle />
        <ThemeToggle labels={{ toDark: t('common.darkMode'), toLight: t('common.lightMode') }} />
      </div>
      <main id="main" className="flex-1">
        {children}
      </main>
      <footer className="mt-10 flex flex-col items-center gap-2 text-center text-xs text-muted">
        <Link to="/" aria-label={t('brand.name')}>
          <Logo className="h-8" label={t('brand.label')} alt={t('brand.name')} />
        </Link>
        <nav className="flex gap-4">
          <Link to="/privacy" className="hover:text-accent">
            {t('legal.privacy')}
          </Link>
          <Link to="/terms" className="hover:text-accent">
            {t('legal.terms')}
          </Link>
          <Link to="/support" className="hover:text-accent">
            {t('legal.support')}
          </Link>
        </nav>
      </footer>
    </div>
  )
}
