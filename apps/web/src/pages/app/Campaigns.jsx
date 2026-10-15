/* Campaigns: compose a message, preview how it lands on a phone, send it to
   every matching wallet pass. Sending is immutable and idempotent per attempt. */

import { Badge, Button, Card, EmptyState, Field, Input, Modal, MqBell, MqMegaphone, Select, Skeleton, Textarea, useToast } from '@mirqam/ui'
import { useState } from 'react'
import { PageHeader } from '../../components/AppShell.jsx'
import Pagination from '../../components/Pagination.jsx'
import { useErrorText, useI18n } from '../../i18n/index.jsx'
import { api, useApi, useIdempotencyKey } from '../../lib/api.js'
import { dateTime, num } from '../../lib/format.js'
import { useSession } from '../../lib/session.jsx'

const TITLE_MAX = 40
const BODY_MAX = 200
const DAILY_LIMIT = 3
const PAGE = 10

/* What the customer sees on the lock screen: wallet-style notification card. */
function NotificationPreview({ merchant, title, body }) {
  const { t } = useI18n()
  return (
    <div className="rounded-2xl border border-line bg-soft p-4">
      <p className="mb-2 text-xs font-semibold text-muted">{t('campaigns.preview')}</p>
      <div className="flex items-start gap-3 rounded-2xl bg-surface p-3 shadow-card">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary text-white">
          <MqBell className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <p className="truncate text-sm font-bold">{merchant}</p>
            <span className="shrink-0 text-[11px] text-muted">{t('campaigns.previewNow')}</span>
          </div>
          <p className="truncate text-sm font-semibold">{title || t('campaigns.previewPlaceholderTitle')}</p>
          <p className="break-words text-sm text-muted">{body || t('campaigns.previewPlaceholderBody')}</p>
        </div>
      </div>
    </div>
  )
}

function Composer({ programs, onSent }) {
  const { t } = useI18n()
  const errorText = useErrorText()
  const toast = useToast()
  const { me } = useSession()
  const [form, setForm] = useState({ programId: programs[0].id, audience: 'consented', title: '', body: '' })
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))
  const idem = useIdempotencyKey(JSON.stringify(form))
  const audience = useApi(`/campaigns/audience?programId=${form.programId}&audience=${form.audience}`)
  const reach = audience.data?.recipients ?? 0
  const sendsLeft = audience.data?.sendsLeft ?? DAILY_LIMIT
  const ready = form.title.trim() && form.body.trim() && reach > 0 && sendsLeft > 0

  async function send() {
    setBusy(true)
    setError(null)
    try {
      const res = await api('/campaigns', { method: 'POST', body: form, idempotencyKey: idem.key })
      idem.rotate()
      setConfirming(false)
      setForm((f) => ({ ...f, title: '', body: '' }))
      toast?.(t('campaigns.sent', { n: num(res.campaign.recipients) }))
      audience.reload()
      onSent()
    } catch (err) {
      setError(err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card title={t('campaigns.new')} subtitle={t('campaigns.consentNote')} bodyClass="p-6">
      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            if (ready) setConfirming(true)
          }}
          noValidate
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('campaigns.program')}>
              {(p) => (
                <Select {...p} value={form.programId} onChange={set('programId')}>
                  {programs.map((pr) => (
                    <option key={pr.id} value={pr.id}>
                      {pr.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label={t('campaigns.audience')}>
              {(p) => (
                <Select {...p} value={form.audience} onChange={set('audience')}>
                  <option value="consented">{t('campaigns.audienceConsented')}</option>
                  <option value="all">{t('campaigns.audienceAll')}</option>
                </Select>
              )}
            </Field>
          </div>
          <Field label={t('campaigns.title')} hint={t('campaigns.titleHint', { max: TITLE_MAX })}>
            {(p) => <Input {...p} value={form.title} onChange={set('title')} maxLength={TITLE_MAX} autoComplete="off" />}
          </Field>
          <Field label={t('campaigns.body')} hint={t('campaigns.bodyHint', { max: BODY_MAX })}>
            {(p) => <Textarea {...p} rows={4} value={form.body} onChange={set('body')} maxLength={BODY_MAX} />}
          </Field>
          <p className="text-sm font-semibold text-accent">{reach > 0 ? t('campaigns.reach', { n: num(reach) }) : t('campaigns.reachNone')}</p>
          <p className="-mt-2 text-xs text-muted">{t('campaigns.sendsLeft', { n: num(sendsLeft), max: num(DAILY_LIMIT) })}</p>
          {error && !confirming && (
            <p role="alert" className="rounded-xl border border-err/20 bg-err-bg px-4 py-3 text-sm text-err">
              {errorText(error)}
            </p>
          )}
          <div>
            <Button type="submit" size="lg" disabled={!ready}>
              <MqMegaphone className="h-5 w-5" />
              {t('campaigns.send')}
            </Button>
          </div>
          <p className="text-xs text-muted">{t('campaigns.limitNote', { max: num(DAILY_LIMIT) })}</p>
        </form>
        <NotificationPreview merchant={me?.tenant.name} title={form.title.trim()} body={form.body.trim()} />
      </div>

      <Modal
        open={confirming}
        onClose={() => setConfirming(false)}
        title={t('campaigns.confirmTitle')}
        closeLabel={t('common.close')}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirming(false)}>
              {t('common.cancel')}
            </Button>
            <Button onClick={send} loading={busy}>
              {t('campaigns.confirmSend', { n: num(reach) })}
            </Button>
          </>
        }
      >
        <div className="grid gap-4">
          <p className="text-sm">{t('campaigns.confirmBody', { n: num(reach) })}</p>
          <NotificationPreview merchant={me?.tenant.name} title={form.title.trim()} body={form.body.trim()} />
          {error && (
            <p role="alert" className="rounded-xl border border-err/20 bg-err-bg px-4 py-3 text-sm text-err">
              {errorText(error)}
            </p>
          )}
        </div>
      </Modal>
    </Card>
  )
}

function History({ refreshKey }) {
  const { t, locale } = useI18n()
  const [offset, setOffset] = useState(0)
  const { data, loading } = useApi(`/campaigns?limit=${PAGE}&offset=${offset}&v=${refreshKey}`)
  return (
    <Card title={t('campaigns.history')} bodyClass="">
      {loading && !data ? (
        <Skeleton className="px-6" rows={2} />
      ) : data?.items.length ? (
        <>
          <ul className="divide-y divide-line">
            {data.items.map((c) => (
              <li key={c.id} className="grid gap-1 px-6 py-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-bold">{c.title}</p>
                  <Badge tone={c.status === 'sent' ? 'green' : 'gray'}>{t(c.status === 'sent' ? 'campaigns.delivered' : 'campaigns.sending')}</Badge>
                </div>
                <p className="break-words text-sm text-muted">{c.body}</p>
                <p className="text-xs text-muted">
                  {c.programName} · {t('campaigns.recipients', { n: num(c.recipients) })} · {dateTime(c.createdAt, locale)}
                  {c.createdBy ? ` · ${t('campaigns.by', { name: c.createdBy })}` : ''}
                </p>
              </li>
            ))}
          </ul>
          <Pagination total={data.total} limit={PAGE} offset={offset} onChange={setOffset} />
        </>
      ) : (
        <EmptyState icon={MqMegaphone} title={t('campaigns.emptyTitle')} desc={t('campaigns.emptyBody')} />
      )}
    </Card>
  )
}

export default function Campaigns() {
  const { t } = useI18n()
  const programs = useApi('/programs')
  const [refreshKey, setRefreshKey] = useState(0)
  const active = programs.data?.items.filter((p) => p.status === 'active') ?? []
  return (
    <>
      <PageHeader title={t('nav.campaigns')} subtitle={t('campaigns.subtitle')} />
      <div className="grid gap-6">
        {programs.loading && !programs.data ? (
          <Skeleton className="px-6" rows={2} />
        ) : active.length ? (
          <Composer programs={active} onSent={() => setRefreshKey((k) => k + 1)} />
        ) : (
          <Card>
            <EmptyState icon={MqMegaphone} title={t('nav.campaigns')} desc={t('campaigns.noPrograms')} />
          </Card>
        )}
        <History refreshKey={refreshKey} />
      </div>
    </>
  )
}
