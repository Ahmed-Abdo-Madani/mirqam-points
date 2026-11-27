import {
  Badge,
  Logo,
  Menu,
  MqCoins,
  MqDashboard,
  MqGift,
  MqLanguage,
  MqLedger,
  MqLogOut,
  MqMegaphone,
  MqScan,
  MqSettings,
  MqUserPlus,
  MqUsers,
  ThemeToggle,
} from '@mirqam/ui'
import { useEffect } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useI18n } from '../i18n/index.jsx'
import { useApi } from '../lib/api.js'
import { takeLanding } from '../lib/auth-landing.js'
import { PURCHASES_IN_APP } from '../lib/platform.js'
import { useSession } from '../lib/session.jsx'

/* Every page the role can open, in menu order. The side menu shows them all; Home on phones shows the admin ones as shortcuts. */
export function useNavItems() {
  const { t } = useI18n()
  const { can } = useSession()
  return [
    { to: '/app/billing', icon: MqCoins, label: t('billing.title'), show: can('owner') && PURCHASES_IN_APP },
    { to: '/app', end: true, icon: MqDashboard, label: t('nav.dashboard') },
    { to: '/app/cashier', icon: MqScan, label: t('nav.cashier'), show: can('transact') },
    { to: '/app/members', icon: MqUsers, label: t('nav.members') },
    { to: '/app/programs', icon: MqCoins, label: t('nav.programs') },
    { to: '/app/campaigns', icon: MqMegaphone, label: t('nav.campaigns'), show: can('manage') },
    { to: '/app/gift-cards', icon: MqGift, label: t('nav.giftCards') },
    { to: '/app/activity', icon: MqLedger, label: t('nav.activity') },
    { to: '/app/staff', icon: MqUserPlus, label: t('nav.staff'), show: can('manage') },
    { to: '/app/settings', icon: MqSettings, label: t('nav.settings') },
  ].filter((item) => item.show !== false)
}

function SideNav() {
  const { t } = useI18n()
  const { me } = useSession()
  const nav = useNavItems()
  const link =
    'flex min-h-11 items-center gap-3 rounded-[14px] border border-transparent px-3 text-[13px] font-medium text-navy-100 transition hover:bg-white/5 hover:text-white'
  return (
    <div className="flex h-full flex-col gap-6 overflow-y-auto p-4">
      <div className="px-1 pt-2">
        <Logo inverse className="h-11" label={t('brand.label')} sublabel="LOYALTY & GIFT CARDS" alt={t('brand.name')} />
      </div>
      <nav aria-label={t('nav.main')} className="grid gap-1">
        {nav.map(({ to, end, icon: Icon, label }) => (
          <NavLink key={to} to={to} end={end} className={link}>
            <Icon className="h-[19px] w-[19px] shrink-0" />
            {label}
          </NavLink>
        ))}
      </nav>
      <div className="mt-auto rounded-2xl border border-white/10 bg-white/5 p-3.5">
        <p className="truncate text-sm font-bold text-white">{me?.tenant.name}</p>
        <p className="mt-0.5 text-[11px] text-navy-200">{t(`roles.${me?.role}`)}</p>
      </div>
    </div>
  )
}

/* Phones and the mobile app: three tabs with Scan in the middle, the layout counter staff already know
   from other loyalty apps. Admin pages are reached from Home; the desktop keeps the side menu. */
function BottomTabs() {
  const { t } = useI18n()
  const { can } = useSession()
  const tab = ({ isActive }) =>
    `flex min-h-14 flex-col items-center justify-end gap-1 text-[11.5px] font-semibold transition ${isActive ? 'text-accent' : 'text-muted hover:text-ink'}`
  return (
    <nav
      aria-label={t('tabs.label')}
      className="no-print fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/95 px-3 pt-1.5 backdrop-blur lg:hidden"
      style={{ paddingBottom: 'max(10px, env(safe-area-inset-bottom))' }}
    >
      <div className="mx-auto grid max-w-md grid-cols-3 items-end">
        <NavLink to="/app" end className={tab}>
          <MqDashboard className="h-[22px] w-[22px]" />
          {t('tabs.home')}
        </NavLink>
        {can('transact') ? (
          <NavLink to="/app/cashier" className={tab}>
            {({ isActive }) => (
              <>
                <span
                  className={`-mt-7 flex h-[60px] w-[60px] items-center justify-center rounded-full border-[5px] border-surface text-on-primary shadow-card ${isActive ? 'bg-accent' : 'bg-primary'}`}
                >
                  <MqScan className="h-7 w-7" />
                </span>
                {t('tabs.scan')}
              </>
            )}
          </NavLink>
        ) : (
          <span />
        )}
        <NavLink to="/app/preferences" className={tab}>
          <MqSettings className="h-[22px] w-[22px]" />
          {t('tabs.settings')}
        </NavLink>
      </div>
    </nav>
  )
}

export function LocaleToggle({ className = '' }) {
  const { t, locale, setLocale } = useI18n()
  return (
    <button
      type="button"
      onClick={() => setLocale(locale === 'ar' ? 'en' : 'ar')}
      className={`inline-flex h-10 items-center gap-1.5 rounded-[var(--radius-control)] border border-line bg-surface px-3 text-xs font-semibold text-muted transition hover:text-ink ${className}`}
      lang={locale === 'ar' ? 'en' : 'ar'}
    >
      <MqLanguage className="h-4 w-4" />
      {t('common.otherLanguage')}
    </button>
  )
}

export function PageHeader({ title, subtitle, actions }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-[22px] font-bold leading-snug sm:text-2xl">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  )
}

/* Renewal notice for every role: the subscription is ending, has ended, or (when the paywall is on) is missing. */
function SubscriptionBanner() {
  const { t } = useI18n()
  const { can } = useSession()
  const { data } = useApi('/billing/state')
  if (!data) return null
  const { state, daysLeft, enforced } = data
  const show = state === 'expiring' || state === 'expired' || (enforced && (state === 'none' || state === 'trial'))
  if (!show) return null
  const bad = state === 'expired' || state === 'none'
  // The iOS app shows status only (no renewal call to action); see lib/platform.js.
  const copyKey = PURCHASES_IN_APP ? `billing.banner.${state}` : `billing.status.${state}`
  return (
    <div
      role={bad ? 'alert' : 'status'}
      className={`mb-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border px-4 py-3 text-sm ${bad ? 'border-err/20 bg-err-bg text-err' : 'border-warn/20 bg-warn-bg text-warn'}`}
    >
      <span className="font-semibold">{t(copyKey, { n: daysLeft })}</span>
      {!PURCHASES_IN_APP ? null : can('owner') ? (
        <NavLink to="/app/billing" className="font-bold underline">
          {t('billing.banner.cta')}
        </NavLink>
      ) : (
        <span>{t('billing.banner.ownerOnly')}</span>
      )}
    </div>
  )
}

export default function AppShell() {
  const { t } = useI18n()
  const { me, logout } = useSession()
  const navigate = useNavigate()
  // Back from a social sign-in that started on a pager sign-up: go where the visitor was headed, once.
  // biome-ignore lint/correctness/useExhaustiveDependencies: once on mount.
  useEffect(() => {
    const to = takeLanding()
    if (to) navigate(to, { replace: true })
  }, [])

  return (
    <div className="min-h-dvh lg:flex">
      <a href="#main" className="sr-only z-[100] rounded-xl bg-primary px-4 py-2 text-on-primary focus:not-sr-only focus:fixed focus:start-4 focus:top-4">
        {t('common.skipToContent')}
      </a>

      <aside className="mp-sidebar sticky top-3 m-3 me-0 hidden h-[calc(100dvh-24px)] w-[248px] shrink-0 rounded-[26px] lg:block">
        <SideNav />
      </aside>

      <div className="min-w-0 flex-1">
        <header className="mq-card no-print sticky top-3 z-30 mx-3 mt-3 flex items-center gap-2 px-3 py-2.5 sm:px-5 lg:mx-4">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-bold">{me?.tenant.name}</p>
            <p className="truncate text-[11px] text-muted">{t('brand.name')}</p>
          </div>
          <LocaleToggle className="hidden sm:inline-flex" />
          <ThemeToggle labels={{ toDark: t('common.darkMode'), toLight: t('common.lightMode') }} />
          <Menu
            button={({ toggle, open }) => (
              <button
                type="button"
                onClick={toggle}
                aria-expanded={open}
                aria-haspopup="menu"
                className="flex h-10 items-center gap-2 rounded-[var(--radius-control)] border border-line bg-surface ps-1.5 pe-3 text-sm font-semibold"
              >
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-tint text-xs font-bold text-accent">{me?.user.name?.[0]}</span>
                <span className="hidden max-w-32 truncate sm:inline">{me?.user.name}</span>
              </button>
            )}
            header={
              <>
                <p className="text-sm font-bold">{me?.user.name}</p>
                <p className="text-xs text-muted" dir="ltr">
                  {me?.user.email}
                </p>
              </>
            }
            items={[
              {
                label: t('auth.logout'),
                icon: <MqLogOut className="h-4 w-4" />,
                danger: true,
                onClick: async () => {
                  await logout()
                  navigate('/login')
                },
              },
            ]}
          />
        </header>

        <main id="main" className="mx-auto w-full max-w-[1240px] px-4 pb-32 pt-7 sm:px-6 lg:px-8 lg:pb-24">
          <SubscriptionBanner />
          <Outlet />
        </main>
      </div>
      <BottomTabs />
    </div>
  )
}

export function RoleBadge({ role }) {
  const { t } = useI18n()
  const tone = { owner: 'teal', manager: 'blue', cashier: 'gray', analyst: 'amber' }[role]
  return <Badge tone={tone}>{t(`roles.${role}`)}</Badge>
}
