import { Badge, Button, Card } from '@mirqam/ui'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useErrorText, useI18n } from '../../../i18n/index.jsx'
import { api, useApi } from '../../../lib/api.js'

/* Pager → Setup, stream S7: what the customer pager page offers beyond the number.
   - The business's country (the page's phone forms default to it).
   - Per branch, which Loyalty program the page offers ("None" by default).
   - WhatsApp alerts from the business's own number (Plus): link with the bot's QR, re-link, unlink.
   Only for a pager business run here; a real POS business keeps its loyalty and WhatsApp in Mirqam POS. */
export default function PagerLoyaltySetup({ state, reload }) {
  if (!state || state.managedInPos) return null
  return (
    <div className="grid gap-5">
      <BranchOffers state={state} reload={reload} />
      <WhatsAppAlerts plus={Boolean(state.plan?.plusFeatures)} />
      <BusinessCountry state={state} reload={reload} />
    </div>
  )
}

function useAct(reload) {
  const errorText = useErrorText()
  const [failure, setFailure] = useState(null)
  const [busy, setBusy] = useState(false)
  const act = async (fn) => {
    setFailure(null)
    setBusy(true)
    try {
      const out = await fn()
      reload?.()
      return out
    } catch (e) {
      setFailure(e)
      return null
    } finally {
      setBusy(false)
    }
  }
  const alert = failure ? (
    <p role="alert" className="rounded-xl border border-err/20 bg-err-bg px-4 py-3 text-sm text-err">
      {errorText(failure)}
    </p>
  ) : null
  return { act, busy, alert }
}

function BranchOffers({ state, reload }) {
  const { t } = useI18n()
  const { data } = useApi('/pager/offers')
  const programs = data?.programs ?? []
  const { act, busy, alert } = useAct(reload)
  const branches = state.branches.filter((b) => b.active !== false)
  return (
    <Card title={t('pagerOffer.offers.title')} subtitle={t('pagerOffer.offers.hint')}>
      <div className="grid gap-3">
        {alert}
        {!programs.length && <p className="text-sm text-muted">{t('pagerOffer.offers.noPrograms')}</p>}
        {branches.map((b) => (
          <label key={b.id} className="flex flex-wrap items-center justify-between gap-3 text-sm">
            <span className="font-semibold">{b.name}</span>
            <select
              className="min-h-11 min-w-48 rounded-xl border border-line bg-surface px-3"
              aria-label={t('pagerOffer.offers.pick', { branch: b.name })}
              value={b.loyaltyOffer?.programId ?? ''}
              disabled={busy}
              onChange={(e) => act(() => api(`/pager/offers/${b.id}`, { method: 'PUT', body: { programId: e.target.value || null } }))}
            >
              <option value="">{t('pagerOffer.offers.none')}</option>
              {programs.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
              {/* Still chosen but no longer active (archived): shown so the owner sees why the page hides it. */}
              {b.loyaltyOffer && !programs.some((p) => p.id === b.loyaltyOffer.programId) && (
                <option value={b.loyaltyOffer.programId}>{t('pagerOffer.offers.inactive', { name: b.loyaltyOffer.name })}</option>
              )}
            </select>
          </label>
        ))}
      </div>
    </Card>
  )
}

const POLL_MS = 3000
const PAIR_MINUTES = 2

function WhatsAppAlerts({ plus }) {
  const { t } = useI18n()
  const { data, reload } = useApi(plus ? '/pager/whatsapp' : null)
  const { act, busy, alert } = useAct()
  const [qr, setQr] = useState(null)
  const [pairedAt, setPairedAt] = useState(0)
  const pairing = Boolean(qr) && !data?.connected && Date.now() - pairedAt < PAIR_MINUTES * 60_000

  // While the QR is up, look every few seconds until the phone has scanned it.
  useEffect(() => {
    if (!pairing) return undefined
    const timer = setInterval(reload, POLL_MS)
    return () => clearInterval(timer)
  }, [pairing, reload])
  useEffect(() => {
    if (data?.connected) setQr(null)
  }, [data?.connected])

  const pair = useCallback(async () => {
    const out = await act(() => api('/pager/whatsapp/pair', { method: 'POST', body: {} }))
    if (out?.qrDataUrl) {
      setQr(out.qrDataUrl)
      setPairedAt(Date.now())
    }
    reload()
  }, [act, reload])

  if (!plus) {
    return (
      <Card title={t('pagerOffer.wa.title')} subtitle={t('pagerOffer.wa.hint')}>
        <p className="text-sm text-muted">{t('pagerOffer.wa.plusOnly')}</p>
      </Card>
    )
  }
  const connected = data?.connected === true
  return (
    <Card title={t('pagerOffer.wa.title')} subtitle={t('pagerOffer.wa.hint')}>
      <div className="grid gap-3">
        {alert}
        <div className="flex flex-wrap items-center gap-3 text-sm">
          {connected ? <Badge tone="green">{t('pagerOffer.wa.connected')}</Badge> : <Badge tone="gray">{t('pagerOffer.wa.notConnected')}</Badge>}
          {connected && data?.last4 && (
            <span className="tnum" dir="ltr">
              •••• {data.last4}
            </span>
          )}
        </div>
        {!connected && <p className="text-sm text-muted">{data?.linked ? t('pagerOffer.wa.whyOffDropped') : t('pagerOffer.wa.whyOff')}</p>}
        {qr && !connected && (
          <div className="grid justify-items-center gap-2 rounded-xl border border-line p-4">
            <img src={qr} alt={t('pagerOffer.wa.qrAlt')} className="h-56 w-56" />
            <p className="text-center text-sm">{t('pagerOffer.wa.scan')}</p>
            {!pairing && <p className="text-center text-xs text-muted">{t('pagerOffer.wa.qrExpired')}</p>}
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <Button onClick={pair} disabled={busy}>
            {data?.linked ? t('pagerOffer.wa.relink') : t('pagerOffer.wa.link')}
          </Button>
          {data?.linked && (
            <Button
              variant="outline"
              disabled={busy}
              onClick={async () => {
                if (!window.confirm(t('pagerOffer.wa.unlinkConfirm'))) return
                await act(() => api('/pager/whatsapp/unlink', { method: 'POST', body: {} }))
                setQr(null)
                reload()
              }}
            >
              {t('pagerOffer.wa.unlink')}
            </Button>
          )}
        </div>
      </div>
    </Card>
  )
}

function BusinessCountry({ state, reload }) {
  const { t, locale: lang } = useI18n()
  const { act, busy, alert } = useAct(reload)
  const current = state.settings?.country ?? 'SA'
  const options = useMemo(() => {
    let names = null
    try {
      names = new Intl.DisplayNames([lang], { type: 'region' })
    } catch {
      names = null
    }
    return COUNTRIES.map((code) => ({ code, name: names?.of(code) ?? code })).sort((a, b) => a.name.localeCompare(b.name, lang))
  }, [lang])
  return (
    <Card title={t('pagerOffer.country.title')} subtitle={t('pagerOffer.country.hint')}>
      <div className="grid gap-3">
        {alert}
        <select
          className="min-h-11 max-w-sm rounded-xl border border-line bg-surface px-3"
          aria-label={t('pagerOffer.country.title')}
          value={current}
          disabled={busy}
          onChange={(e) => act(() => api('/pager/country', { method: 'PUT', body: { country: e.target.value } }))}
        >
          {options.map((o) => (
            <option key={o.code} value={o.code}>
              {o.name}
            </option>
          ))}
        </select>
      </div>
    </Card>
  )
}

// ISO 3166 alpha-2 codes the customer page's country picker knows (apps/online-store/src/pager/countries.ts).
const COUNTRIES =
  'AD AE AF AG AI AL AM AO AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GT GU GW GY HK HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG US UY UZ VA VC VE VG VI VN VU WF WS XK YE YT ZA ZM ZW'.split(
    ' ',
  )
