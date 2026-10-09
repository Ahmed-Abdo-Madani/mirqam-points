import { Button, EmptyState, Field, Input, MqStamp, Skeleton } from '@mirqam/ui'
import { normalizePhone } from '@mirqam-points/shared'
import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useErrorText, useI18n } from '../../i18n/index.jsx'
import { api, useApi } from '../../lib/api.js'
import { ruleSummary } from '../../lib/programs.js'
import PublicCardShell from './PublicCardShell.jsx'

/** /join/:slug/:programId — self-enrollment from a QR poster at the counter (new numbers only). */
export default function JoinPage() {
  const { slug, programId } = useParams()
  const { t, locale } = useI18n()
  const errorText = useErrorText()
  const navigate = useNavigate()
  const { data, error } = useApi(`/public/join/${slug}/${programId}`)
  const [form, setForm] = useState({ phone: '', name: '', marketingConsent: false, acceptTerms: false })
  const [busy, setBusy] = useState(false)
  const [fail, setFail] = useState(null)
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }))
  const ok = Boolean(normalizePhone(form.phone)) && form.acceptTerms

  async function submit(e) {
    e.preventDefault()
    setBusy(true)
    setFail(null)
    try {
      const body = { phone: form.phone, marketingConsent: form.marketingConsent, acceptTerms: true, locale }
      if (form.name.trim()) body.name = form.name.trim()
      const res = await api(`/public/join/${slug}/${programId}`, { method: 'POST', body })
      navigate(`/p/${res.passToken}`, { replace: true })
    } catch (err) {
      setFail(err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <PublicCardShell>
      {error ? (
        <EmptyState icon={MqStamp} title={t('join.unavailable')} />
      ) : !data ? (
        <Skeleton rows={2} />
      ) : (
        <div className="fade-in">
          <p className="text-sm font-semibold text-accent">{data.merchant}</p>
          <h1 className="mt-1 text-2xl font-bold">{t('join.title', { program: data.programName })}</h1>
          <p className="mt-2 text-sm text-muted">{ruleSummary({ type: data.type, config: data.config }, t, locale)}</p>
          <form onSubmit={submit} className="mt-6 grid gap-4" noValidate>
            <Field label={t('members.phone')} hint={t('members.phoneHint')}>
              {(p) => (
                <Input {...p} type="tel" inputMode="tel" dir="ltr" value={form.phone} onChange={set('phone')} placeholder="05XXXXXXXX" autoComplete="tel" />
              )}
            </Field>
            <Field label={t('members.name')}>{(p) => <Input {...p} value={form.name} onChange={set('name')} autoComplete="name" maxLength={120} />}</Field>
            <label className="flex items-start gap-3 text-sm">
              <input type="checkbox" checked={form.marketingConsent} onChange={set('marketingConsent')} className="mt-1 h-4 w-4 accent-brand-600" />
              <span>{t('members.consent')}</span>
            </label>
            <label className="flex items-start gap-3 text-sm">
              <input type="checkbox" checked={form.acceptTerms} onChange={set('acceptTerms')} className="mt-1 h-4 w-4 accent-brand-600" />
              <span>
                {t('join.acceptPrefix')}{' '}
                <Link to="/terms" className="font-semibold text-accent underline">
                  {t('legal.terms')}
                </Link>{' '}
                {t('join.and')}{' '}
                <Link to="/privacy" className="font-semibold text-accent underline">
                  {t('legal.privacy')}
                </Link>
              </span>
            </label>
            {fail && (
              <p role="alert" className="rounded-xl border border-err/20 bg-err-bg px-4 py-3 text-sm text-err">
                {errorText(fail)}
              </p>
            )}
            <Button type="submit" size="lg" loading={busy} disabled={!ok}>
              {t('join.submit')}
            </Button>
          </form>
        </div>
      )}
    </PublicCardShell>
  )
}
