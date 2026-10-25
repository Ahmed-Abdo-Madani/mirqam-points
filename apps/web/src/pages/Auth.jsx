import { Button, Field, Input, Logo, MqCheck, Pattern, ThemeToggle } from '@mirqam/ui'
import { useEffect, useState } from 'react'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { LocaleToggle } from '../components/AppShell.jsx'
import PassPreview from '../components/PassPreview.jsx'
import { useErrorText, useI18n } from '../i18n/index.jsx'
import { api } from '../lib/api.js'
import { REGISTRATION_IN_APP } from '../lib/platform.js'
import { useSession } from '../lib/session.jsx'

function fieldErrors(err, t) {
  const out = {}
  for (const d of err?.body?.details ?? []) out[d.path] ??= t(`validation.${d.path}`)
  return out
}

/* Only allow in-app relative redirects (no open redirect via ?next=). */
function safeNext(value) {
  return typeof value === 'string' && value.startsWith('/app') && !value.startsWith('//') ? value : '/app'
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

  if (register && !REGISTRATION_IN_APP) return <Navigate to="/login" replace />

  if (session.status === 'auth') return <Navigate to={safeNext(params.get('next'))} replace />

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
      navigate(safeNext(params.get('next')), { replace: true })
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
          <Logo inverse className="h-12" label={t('brand.label')} sublabel="LOYALTY & GIFT CARDS" alt={t('brand.name')} />
        </Link>
        <div className="relative max-w-md">
          <h2 className="text-3xl font-bold leading-snug">{t('auth.panelTitle')}</h2>
          <ul className="mt-6 grid gap-3 text-sm text-navy-100">
            {['panel1', 'panel2', 'panel3'].map((k) => (
              <li key={k} className="flex items-center gap-2.5">
                <MqCheck className="h-4 w-4 text-brand-300" />
                {t(`auth.${k}`)}
              </li>
            ))}
          </ul>
        </div>
        <PassPreview
          className="relative"
          merchant={t('landing.demoMerchant')}
          programName={t('landing.demoPointsProgram')}
          balance={1250}
          memberName={t('landing.demoMember')}
          labels={{ balance: t('pass.points'), member: t('pass.member') }}
        />
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
          <h1 className="text-[28px] font-bold">{t(register ? 'auth.registerTitle' : 'auth.loginTitle')}</h1>
          <p className="mt-2 text-sm text-muted">{t(register ? 'auth.registerSubtitle' : 'auth.loginSubtitle')}</p>

          <div className="mt-6 grid gap-3">
            {providers.map((provider) => (
              <a
                key={provider}
                className="rounded-xl border border-line bg-surface px-4 py-3 text-center font-semibold text-ink focus-visible:outline-accent"
                href={'/api/auth/social/' + provider}
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

          {REGISTRATION_IN_APP && <p className="mt-6 text-center text-sm text-muted">
            {t(register ? 'auth.haveAccount' : 'auth.noAccount')}{' '}
            <Link to={register ? '/login' : '/register'} className="font-semibold text-accent hover:underline">
              {t(register ? 'auth.login' : 'auth.startFree')}
            </Link>
          </p>}
        </main>
      </section>
    </div>
  )
}
