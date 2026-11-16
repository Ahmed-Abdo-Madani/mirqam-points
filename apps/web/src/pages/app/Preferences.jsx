/* The Settings tab on phones and in the mobile app: the few things counter staff change themselves.
   Workspace and account settings (including account deletion) stay one tap away on the full page. */

import { MqChevronDown, MqLanguage, MqLogOut, MqMoon, MqSettings, MqSun, MqUser, useTheme } from '@mirqam/ui'
import { Link, useNavigate } from 'react-router-dom'
import { PageHeader } from '../../components/AppShell.jsx'
import { useI18n } from '../../i18n/index.jsx'
import { useSession } from '../../lib/session.jsx'

const row = 'flex min-h-14 w-full items-center gap-3 px-4 text-start text-sm font-medium transition hover:bg-soft'

export default function Preferences() {
  const { t, locale, setLocale } = useI18n()
  const { me, logout } = useSession()
  const navigate = useNavigate()
  const [theme, setTheme] = useTheme()
  const dark = theme === 'dark'
  const Chevron = () => <MqChevronDown className="ms-auto h-4 w-4 rotate-90 text-muted rtl:-rotate-90" />

  return (
    <div className="mx-auto grid max-w-xl gap-4">
      <PageHeader title={t('tabs.settings')} />
      <div className="mq-card divide-y divide-line overflow-hidden !p-0">
        <button type="button" className={row} onClick={() => setLocale(locale === 'ar' ? 'en' : 'ar')}>
          <MqLanguage className="h-5 w-5 text-muted" />
          {t('preferences.language')}
          <span className="ms-auto font-semibold text-accent" lang={locale === 'ar' ? 'en' : 'ar'}>
            {t('common.otherLanguage')}
          </span>
        </button>
        <button type="button" className={row} onClick={() => setTheme(dark ? 'light' : 'dark')} aria-pressed={dark}>
          {dark ? <MqMoon className="h-5 w-5 text-muted" /> : <MqSun className="h-5 w-5 text-muted" />}
          {t('preferences.appearance')}
          <span className="ms-auto font-semibold text-accent">{t(dark ? 'preferences.dark' : 'preferences.light')}</span>
        </button>
        <div className={`${row} hover:bg-transparent`}>
          <MqUser className="h-5 w-5 text-muted" />
          <span className="min-w-0">
            <span className="block truncate">{me?.user.name}</span>
            <span className="block truncate text-xs text-muted">
              {me?.tenant.name} · {t(`roles.${me?.role}`)}
            </span>
          </span>
        </div>
        <Link to="/app/settings" className={row}>
          <MqSettings className="h-5 w-5 text-muted" />
          {t('preferences.more')}
          <Chevron />
        </Link>
      </div>
      <div className="mq-card overflow-hidden !p-0">
        <button
          type="button"
          className={`${row} text-err`}
          onClick={async () => {
            await logout()
            navigate('/login')
          }}
        >
          <MqLogOut className="h-5 w-5" />
          {t('auth.logout')}
        </button>
      </div>
      <p className="text-center text-xs text-muted">{t('brand.name')}</p>
    </div>
  )
}
