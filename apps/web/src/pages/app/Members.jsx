import { Avatar, Badge, Button, Card, EmptyState, Field, Input, Modal, MqPlus, MqSearch, MqUsers, Skeleton, useToast } from '@mirqam/ui'
import { normalizePhone } from '@mirqam-points/shared'
import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { PageHeader } from '../../components/AppShell.jsx'
import Pagination from '../../components/Pagination.jsx'
import { useErrorText, useI18n } from '../../i18n/index.jsx'
import { api, useApi } from '../../lib/api.js'
import { day, num } from '../../lib/format.js'
import { unitLabel } from '../../lib/programs.js'
import { useSession } from '../../lib/session.jsx'

const PAGE = 25

export function MemberForm({ initialPhone = '', onCreated, onExisting, submitLabel }) {
  const { t } = useI18n()
  const errorText = useErrorText()
  const [form, setForm] = useState({ phone: initialPhone, name: '', email: '', marketingConsent: false })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }))
  const phoneOk = Boolean(normalizePhone(form.phone))

  async function submit(e) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const body = { phone: form.phone, marketingConsent: form.marketingConsent }
      if (form.name.trim()) body.name = form.name.trim()
      if (form.email.trim()) body.email = form.email.trim()
      onCreated(await api('/members', { method: 'POST', body }))
    } catch (err) {
      if (err.code === 'member_exists' && onExisting) onExisting(err.body.memberId)
      else setError(err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-4" noValidate>
      <Field label={t('members.phone')} hint={t('members.phoneHint')} error={form.phone && !phoneOk ? t('validation.phone') : undefined}>
        {(p) => <Input {...p} type="tel" dir="ltr" inputMode="tel" value={form.phone} onChange={set('phone')} placeholder="05XXXXXXXX" autoComplete="off" />}
      </Field>
      <Field label={t('members.name')}>{(p) => <Input {...p} value={form.name} onChange={set('name')} maxLength={120} />}</Field>
      <Field label={t('members.email')}>{(p) => <Input {...p} type="email" dir="ltr" value={form.email} onChange={set('email')} />}</Field>
      <label className="flex items-start gap-3 rounded-2xl border border-line p-4 text-sm">
        <input type="checkbox" checked={form.marketingConsent} onChange={set('marketingConsent')} className="mt-1 h-4 w-4 accent-brand-600" />
        <span>
          <span className="block font-semibold">{t('members.consent')}</span>
          <span className="mt-0.5 block text-xs text-muted">{t('members.consentHint')}</span>
        </span>
      </label>
      {error && (
        <p role="alert" className="rounded-xl border border-err/20 bg-err-bg px-4 py-3 text-sm text-err">
          {errorText(error)}
        </p>
      )}
      <Button type="submit" loading={busy} disabled={!phoneOk}>
        {submitLabel ?? t('members.add')}
      </Button>
    </form>
  )
}

export default function Members() {
  const { t, locale } = useI18n()
  const toast = useToast()
  const navigate = useNavigate()
  const { can } = useSession()
  const [q, setQ] = useState('')
  const [query, setQuery] = useState('')
  const [offset, setOffset] = useState(0)
  const [adding, setAdding] = useState(false)

  // Debounce search input.
  useEffect(() => {
    const id = setTimeout(() => {
      setQuery(q.trim())
      setOffset(0)
    }, 300)
    return () => clearTimeout(id)
  }, [q])

  const params = new URLSearchParams({ limit: String(PAGE), offset: String(offset) })
  if (query) params.set('q', query)
  const { data, loading } = useApi(`/members?${params}`)

  return (
    <>
      <PageHeader
        title={t('nav.members')}
        subtitle={t('members.subtitle')}
        actions={
          can('transact') && (
            <Button onClick={() => setAdding(true)}>
              <MqPlus className="h-4 w-4" />
              {t('members.add')}
            </Button>
          )
        }
      />
      <Card bodyClass="">
        <div className="border-b border-line p-4">
          <label className="relative block max-w-md">
            <span className="sr-only">{t('members.search')}</span>
            <MqSearch className="pointer-events-none absolute start-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('members.search')} className="ps-10" type="search" />
          </label>
        </div>
        {loading && !data ? (
          <Skeleton className="px-6" rows={2} />
        ) : !data?.items.length ? (
          <EmptyState icon={MqUsers} title={t(query ? 'members.noResults' : 'members.emptyTitle')} desc={query ? undefined : t('members.emptyBody')} />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px]">
                <thead className="border-b border-line">
                  <tr>
                    <th className="th-base">{t('members.member')}</th>
                    <th className="th-base">{t('members.phone')}</th>
                    <th className="th-base">{t('members.balance')}</th>
                    <th className="th-base">{t('members.marketing')}</th>
                    <th className="th-base">{t('members.joined')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {data.items.map((m) => (
                    <tr key={m.id} className="cursor-pointer transition hover:bg-brand-500/[0.03]" onClick={() => navigate(`/app/members/${m.id}`)}>
                      <td className="td-base">
                        {/* Real link for keyboard and screen-reader users; the row click is a mouse convenience. */}
                        <Link
                          to={`/app/members/${m.id}`}
                          onClick={(e) => e.stopPropagation()}
                          className="flex items-center gap-3 whitespace-nowrap font-semibold hover:text-accent"
                        >
                          <Avatar name={m.name || m.phone.slice(-2)} size={34} />
                          {m.name || t('members.unnamed')}
                        </Link>
                      </td>
                      <td className="td-base tnum text-muted">
                        <span dir="ltr">{m.phone}</span>
                      </td>
                      <td className="td-base">
                        <span className="flex flex-wrap gap-1.5">
                          {m.balances.length
                            ? m.balances.map((b) => (
                                <span key={b.programId} title={b.name} className="tnum whitespace-nowrap rounded-lg bg-soft px-2 py-0.5 text-xs">
                                  <b className="font-bold">{num(b.balance)}</b> {unitLabel(b.type, t)}
                                </span>
                              ))
                            : '—'}
                        </span>
                      </td>
                      <td className="td-base">
                        {m.marketingConsent ? <Badge tone="green">{t('members.consented')}</Badge> : <Badge>{t('members.notConsented')}</Badge>}
                      </td>
                      <td className="td-base text-muted">{day(m.createdAt, locale)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination total={data.total} limit={PAGE} offset={offset} onChange={setOffset} />
          </>
        )}
      </Card>
      <Modal open={adding} onClose={() => setAdding(false)} title={t('members.add')} closeLabel={t('common.close')}>
        {adding && (
          <MemberForm
            onCreated={(m) => {
              toast(t('members.added'))
              navigate(`/app/members/${m.id}`)
            }}
            onExisting={(id) => {
              toast(t('members.alreadyExists'))
              navigate(`/app/members/${id}`)
            }}
          />
        )}
      </Modal>
    </>
  )
}
