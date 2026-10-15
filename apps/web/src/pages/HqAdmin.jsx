import { Button, Card, Input, Logo, Skeleton, ThemeToggle } from '@mirqam/ui'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useI18n } from '../i18n/index.jsx'
import { api } from '../lib/api.js'

const CENTER = 'https://mirqam.sa/m/ad0ed94a6a279f02a1295ae283efa07d2c18'
export function HqEntry() {
  const { t } = useI18n(),
    once = useRef(false),
    [failed, setFailed] = useState(false)
  useEffect(() => {
    if (once.current) return
    once.current = true
    const code = location.hash.slice(1)
    history.replaceState(null, '', '/hq-entry')
    if (!/^[a-f0-9]{64}$/.test(code)) {
      setFailed(true)
      return
    }
    api('/hq-entry', { method: 'POST', body: { code } })
      .then(() => location.replace('/hq-admin'))
      .catch(() => setFailed(true))
  }, [])
  return (
    <main className="grid min-h-screen place-items-center bg-bg p-6">
      <Card title={t('hq.title')} className="max-w-lg">
        <p role="status" className="text-muted">
          {t(failed ? 'hq.failed' : 'hq.entering')}
        </p>
        {failed && (
          <a className="mt-4 inline-block font-semibold text-accent" href={CENTER}>
            {t('hq.back')}
          </a>
        )}
      </Card>
    </main>
  )
}
export default function HqAdmin() {
  const { t, locale, setLocale } = useI18n(),
    [data, setData] = useState(null),
    [error, setError] = useState(''),
    [q, setQ] = useState('')
  const load = useCallback(() => {
    setError('')
    api('/hq-admin')
      .then(setData)
      .catch((e) => setError(t(e.status === 403 || e.status === 401 ? 'hq.denied' : 'hq.failed')))
  }, [t])
  useEffect(() => {
    load()
  }, [load])
  const tenants = (data?.tenants || []).filter((x) => (x.name + ' ' + x.slug).toLowerCase().includes(q.toLowerCase()))
  return (
    <main className="min-h-screen bg-bg p-4 text-ink sm:p-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <Logo label={t('brand.label')} />
            <h1 className="text-2xl font-bold">{t('hq.title')}</h1>
          </div>
          <div className="flex items-center gap-4">
            <a href={CENTER} className="font-semibold text-accent">
              {t('hq.back')}
            </a>
            <ThemeToggle labels={{ toDark: t('common.darkMode'), toLight: t('common.lightMode') }} />
            <Button variant="outline" onClick={() => setLocale(locale === 'ar' ? 'en' : 'ar')}>
              {t('common.otherLanguage')}
            </Button>
            <Button onClick={load}>{t('hq.refresh')}</Button>
          </div>
        </header>
        {error && (
          <Card>
            <p role="alert" className="text-err">
              {error}
            </p>
          </Card>
        )}
        {!data && !error && (
          <>
            <p>{t('hq.loading')}</p>
            <Skeleton rows={4} />
          </>
        )}
        {data && (
          <>
            <p className="text-xs text-muted">
              {t('hq.updated')}: <span className="tnum">{new Date(data.asOf).toLocaleString()}</span>
            </p>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {[
                ['clients', data.tenants.length],
                ['programs', data.tenants.reduce((n, x) => n + x.programs, 0)],
                ['members', data.tenants.reduce((n, x) => n + x.members, 0)],
                ['collected', new Intl.NumberFormat('en-SA', { style: 'currency', currency: 'SAR' }).format(Number(data.paid.amount) / 100)],
              ].map(([k, v]) => (
                <Card key={k}>
                  <p className="text-sm text-muted">{t(['hq', k].join('.'))}</p>
                  <strong className="tnum mt-3 block text-2xl">{v}</strong>
                </Card>
              ))}
            </div>
            <Card title={t('hq.clients')}>
              <Input className="mb-4" aria-label={t('hq.search')} placeholder={t('hq.search')} value={q} onChange={(e) => setQ(e.target.value)} />
              <div className="overflow-x-auto">
                <table className="w-full text-start text-sm">
                  <thead>
                    <tr>
                      {['name', 'status', 'programs', 'members', 'subscription', 'expires'].map((k) => (
                        <th key={k} className="p-3 text-start">
                          {t(['hq', k].join('.'))}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {tenants.map((x) => (
                      <tr key={x.id} className="border-t border-line">
                        <td className="p-3 font-semibold">
                          {x.name}
                          <div className="text-xs font-normal text-muted">{x.slug}</div>
                        </td>
                        <td>{t(x.closed_at ? 'hq.closed' : 'hq.active')}</td>
                        <td className="tnum">{x.programs}</td>
                        <td className="tnum">{x.members}</td>
                        <td>{t(x.cycle === 'monthly' ? 'hq.monthly' : x.cycle === 'yearly' ? 'hq.yearly' : 'hq.none')}</td>
                        <td className="tnum">{x.expires_at ? new Date(x.expires_at).toLocaleDateString() : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!tenants.length && <p className="p-4 text-muted">{t('hq.empty')}</p>}
              </div>
            </Card>
            <p className="text-sm text-muted">{t('hq.note')}</p>
          </>
        )}
      </div>
    </main>
  )
}
