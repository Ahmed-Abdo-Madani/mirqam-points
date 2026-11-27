import { Button, Field, Input, Logo, MqCheck, Pattern, ThemeToggle } from '@mirqam/ui'
import { PAGER_TRIAL_DAYS } from '@mirqam-points/shared'
import { useEffect, useState } from 'react'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { LocaleToggle } from '../components/AppShell.jsx'
import PassPreview from '../components/PassPreview.jsx'
import { useErrorText, useI18n } from '../i18n/index.jsx'
import { api } from '../lib/api.js'
import { authLanding, authProduct, forgetLanding, rememberLanding } from '../lib/auth-landing.js'
import { PURCHASES_IN_APP, REGISTRATION_IN_APP } from '../lib/platform.js'
import { useSession } from '../lib/session.jsx'

function fieldErrors(err, t) {
  const out = {}
  for (const d of err?.body?.details ?? []) out[d.path] ??= t(`validation.${d.path}`)
  return out
}

export default function Auth({ mode }) {
  const { t, locale } = useI18n()
  const errorText = useErrorText()
  const session = useSession()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const [form, setForm] = useState({ email: '', password: '', name: '', businessName: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [providers, setProviders] = useState([])
  useEffect(() => {
    fetch('/api/auth/social/providers')
      .then((r) => r.json())
      .then((d) => setProviders(d.providers || []))
      .catch(() => {})
  }, [])
  const register = mode === 'register'
  // A new sign-in attempt starts here: a landing kept by an earlier, abandoned social sign-in must not
  // decide where this one lands (an explicit ?next or ?product does). The native social hand-off comes
  // back to this page with ?social=, and keeps it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: once per visit.
  useEffect(() => {
    if (!params.has('social')) forgetLanding()
  }, [])
  // ?product=pager: a Mirqam Pager sign-up (mirqam.sa, pos.mirqam.sa). The pager plan lives in Billing,
  // which the iOS app does not offer, so there it falls back to the dashboard.
  const pager = authProduct(params) === 'pager'
  const landing = (() => {
    const to = authLanding(params)
    return !PURCHASES_IN_APP && to.startsWith('/app/billing') ? '/app' : to
  })()
  const pk = (key) => (pager ? `auth.pager.${key}` : `auth.${key}`)
  const days = { days: PAGER_TRIAL_DAYS }
  const titleKey = pk(register ? 'registerTitle' : 'loginTitle')
  const subtitleKey = pk(register ? 'registerSubtitle' : 'loginSubtitle')
  // Keep ?product and ?next when switching between sign-up and sign-in.
  const query = params.toString() ? `?${params.toString()}` : ''

  if (register && !REGISTRATION_IN_APP) return <Navigate to="/login" replace />

  if (session.status === 'auth') return <Navigate to={landing} replace />

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))
  const fields = fieldErrors(error, t)

  async function submit(e) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const me = register
        ? await api('/auth/register', { method: 'POST', body: { ...form, locale } })
        : await api('/auth/login', { method: 'POST', body: { email: form.email, password: form.password } })
      session.signedIn(me)
      navigate(landing, { replace: true })
    } catch (err) {
      setError(err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid min-h-dvh lg:grid-cols-[1fr_minmax(0,560px)]">
      <section className="mp-welcome relative m-3 hidden overflow-hidden rounded-[28px] text-white lg:flex lg:flex-col lg:justify-between lg:p-12">
        <Pattern variant="waves" opacity={0.1} className="text-brand-300" />
        <Link to="/" className="relative" aria-label={t('brand.name')}>
          <Logo inverse className="h-12" label={t('brand.label')} sublabel={pager ? 'MIRQAM PAGER' : 'LOYALTY & GIFT CARDS'} alt={t('brand.name')} />
        </Link>
        <div className="relative max-w-md">
          <h2 className="text-3xl font-bold leading-snug">{t(pk('panelTitle'), days)}</h2>
          <ul className="mt-6 grid gap-3 text-sm text-navy-100">
            {['panel1', 'panel2', 'panel3'].map((k) => (
              <li key={k} className="flex items-center gap-2.5">
                <MqCheck className="h-4 w-4 text-brand-300" />
                {t(pk(k), days)}
              </li>
            ))}
          </ul>
        </div>
        {pager ? (
          <span aria-hidden="true" />
        ) : (
          <PassPreview
            className="relative"
            merchant={t('landing.demoMerchant')}
            programName={t('landing.demoPointsProgram')}
            balance={1250}
            memberName={t('landing.demoMember')}
            labels={{ balance: t('pass.points'), member: t('pass.member') }}
          />
        )}
      </section>

      <section className="flex flex-col px-5 py-6 sm:px-10">
        <div className="flex items-center justify-between gap-3">
          <Link to="/" className="lg:invisible" aria-label={t('brand.name')}>
            <Logo className="h-10" label={t('brand.label')} alt={t('brand.name')} />
          </Link>
          <div className="flex gap-2">
            <LocaleToggle />
            <ThemeToggle labels={{ toDark: t('common.darkMode'), toLight: t('common.lightMode') }} />
          </div>
        </div>

        <main id="main" className="mx-auto my-auto w-full max-w-[420px] py-10">
          <h1 className="text-[28px] font-bold">{t(titleKey, days)}</h1>
          <p className="mt-2 text-sm text-muted">{t(subtitleKey, days)}</p>

          <div className="mt-6 grid gap-3">
            {providers.map((provider) => (
              <a
                key={provider}
                className="rounded-xl border border-line bg-surface px-4 py-3 text-center font-semibold text-ink focus-visible:outline-accent"
                href={'/api/auth/social/' + provider}
                onClick={() => rememberLanding(landing)}
              >
                {t(provider === 'google' ? 'auth.google' : 'auth.github')}
              </a>
            ))}
          </div>
          <form onSubmit={submit} className="mt-8 grid gap-4" noValidate>
            {register && (
              <>
                <Field label={t('auth.name')} error={fields.name}>
                  {(p) => <Input {...p} value={form.name} onChange={set('name')} autoComplete="name" required />}
                </Field>
                <Field label={t('auth.businessName')} error={fields.businessName}>
                  {(p) => <Input {...p} value={form.businessName} onChange={set('businessName')} autoComplete="organization" required />}
                </Field>
              </>
            )}
            <Field label={t('auth.email')} error={fields.email}>
              {(p) => <Input {...p} type="email" dir="ltr" value={form.email} onChange={set('email')} autoComplete="email" required />}
            </Field>
            <Field label={t('auth.password')} hint={register ? t('auth.passwordHint') : undefined} error={fields.password}>
              {(p) => (
                <Input
                  {...p}
                  type="password"
                  dir="ltr"
                  value={form.password}
                  onChange={set('password')}
                  autoComplete={register ? 'new-password' : 'current-password'}
                  required
                />
              )}
            </Field>
            {error && error.code !== 'validation_failed' && (
              <p role="alert" className="rounded-xl border border-err/20 bg-err-bg px-4 py-3 text-sm text-err">
                {errorText(error)}
              </p>
            )}
            <Button type="submit" size="lg" loading={busy} className="mt-2 w-full">
              {t(register ? 'auth.createAccount' : 'auth.login')}
            </Button>
          </form>

          {REGISTRATION_IN_APP && (
            <p className="mt-6 text-center text-sm text-muted">
              {t(register ? 'auth.haveAccount' : 'auth.noAccount')}{' '}
              <Link to={(register ? '/login' : '/register') + query} className="font-semibold text-accent hover:underline">
                {t(register ? 'auth.login' : 'auth.startFree')}
              </Link>
            </p>
          )}
        </main>

        {/* Reachable before sign-in, in the app too (Google Play requires an in-app privacy policy link). */}
        <nav aria-label={t('settings.legal')} className="flex flex-wrap justify-center gap-x-5 gap-y-2 pb-2 text-xs font-semibold text-muted">
          <Link to="/privacy" className="hover:text-accent">
            {t('legal.privacy')}
          </Link>
          <Link to="/terms" className="hover:text-accent">
            {t('legal.terms')}
          </Link>
          <Link to="/support" className="hover:text-accent">
            {t('legal.support')}
          </Link>
          <Link to="/delete-account" className="hover:text-accent">
            {t('legal.deleteAccount')}
          </Link>
        </nav>
      </section>
    </div>
  )
}
