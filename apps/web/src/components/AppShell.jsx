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
  MqMenu,
  MqScan,
  MqSettings,
  MqUserPlus,
  MqUsers,
  MqX,
  ThemeToggle,
} from '@mirqam/ui'
import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useI18n } from '../i18n/index.jsx'
import { useSession } from '../lib/session.jsx'

function SideNav({ onNavigate }) {
  const { t } = useI18n()
  const { me, can } = useSession()
  const nav = [
    { to: '/app/billing', icon: MqCoins, label: t('billing.title'), show: can('owner') },
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
  const link =
    'flex min-h-11 items-center gap-3 rounded-[14px] border border-transparent px-3 text-[13px] font-medium text-navy-100 transition hover:bg-white/5 hover:text-white'
  return (
    <div className="flex h-full flex-col gap-6 overflow-y-auto p-4">
      <div className="px-1 pt-2">
        <Logo inverse className="h-11" label={t('brand.label')} sublabel="LOYALTY & GIFT CARDS" alt={t('brand.name')} />
      </div>
      <nav aria-label={t('nav.main')} className="grid gap-1">
        {nav.map(({ to, end, icon: Icon, label }) => (
          <NavLink key={to} to={to} end={end} onClick={onNavigate} className={link}>
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

export default function AppShell() {
  const { t } = useI18n()
  const { me, logout } = useSession()
  const [drawer, setDrawer] = useState(false)
  const location = useLocation()
  const navigate = useNavigate()
  // biome-ignore lint/correctness/useExhaustiveDependencies: close the mobile drawer on any navigation (incl. back/forward).
  useEffect(() => setDrawer(false), [location.pathname])

  return (
    <div className="min-h-dvh lg:flex">
      <a href="#main" className="sr-only z-[100] rounded-xl bg-primary px-4 py-2 text-on-primary focus:not-sr-only focus:fixed focus:start-4 focus:top-4">
        {t('common.skipToContent')}
      </a>

      <aside className="mp-sidebar sticky top-3 m-3 me-0 hidden h-[calc(100dvh-24px)] w-[248px] shrink-0 rounded-[26px] lg:block">
        <SideNav />
      </aside>

      {drawer && (
        <div className="fixed inset-0 z-[70] bg-navy-950/50 lg:hidden" onClick={() => setDrawer(false)} aria-hidden="true">
          <aside
            className="mp-sidebar fade-in absolute inset-y-3 start-3 w-[min(280px,85vw)] rounded-[26px]"
            onClick={(e) => e.stopPropagation()}
            aria-label={t('nav.main')}
          >
            <button
              type="button"
              onClick={() => setDrawer(false)}
              className="absolute end-3 top-4 rounded-lg p-1.5 text-navy-100"
              aria-label={t('common.close')}
            >
              <MqX className="h-5 w-5" />
            </button>
            <SideNav onNavigate={() => setDrawer(false)} />
          </aside>
        </div>
      )}

      <div className="min-w-0 flex-1">
        <header className="mq-card no-print sticky top-3 z-30 mx-3 mt-3 flex items-center gap-2 px-3 py-2.5 sm:px-5 lg:mx-4">
          <button type="button" onClick={() => setDrawer(true)} className="rounded-xl p-2 text-muted hover:bg-soft lg:hidden" aria-label={t('nav.open')}>
            <MqMenu className="h-6 w-6" />
          </button>
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

        <main id="main" className="mx-auto w-full max-w-[1240px] px-4 pb-24 pt-7 sm:px-6 lg:px-8">
          <Outlet />
        </main>
      </div>
    </div>
  )
}

export function RoleBadge({ role }) {
  const { t } = useI18n()
  const tone = { owner: 'teal', manager: 'blue', cashier: 'gray', analyst: 'amber' }[role]
  return <Badge tone={tone}>{t(`roles.${role}`)}</Badge>
}
