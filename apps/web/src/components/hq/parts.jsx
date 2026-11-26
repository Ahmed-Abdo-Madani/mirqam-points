import { Badge, Button, MqAlertTriangle, MqRefresh } from '@mirqam/ui'
import { useErrorText, useI18n } from '../../i18n/index.jsx'

/* Entitlement states as computed by the server (billing.entitlement). */
const ENTITLEMENT = {
  posManaged: ['teal', 'hq.ent.posManaged'],
  active: ['green', 'hq.ent.active'],
  expiring: ['amber', 'hq.ent.expiring'],
  trial: ['blue', 'hq.ent.trial'],
  expired: ['red', 'hq.ent.expired'],
  none: ['gray', 'hq.ent.none'],
}
export const ENTITLEMENT_STATES = Object.keys(ENTITLEMENT)

export function EntitlementBadge({ state }) {
  const { t } = useI18n()
  const [tone, key] = ENTITLEMENT[state] ?? ['gray', 'hq.unavailable']
  return <Badge tone={tone}>{t(key)}</Badge>
}
export const entitlementLabel = (t, state) => t(ENTITLEMENT[state]?.[1] ?? 'hq.unavailable')

export function StatusBadge({ status }) {
  const { t } = useI18n()
  return status === 'closed' ? <Badge tone="red">{t('hq.status.closed')}</Badge> : <Badge tone="green">{t('hq.status.open')}</Badge>
}

/** A section that failed to load: what happened, and a way to retry it. */
export function SectionError({ error, onRetry }) {
  const { t } = useI18n()
  const errorText = useErrorText()
  const denied = error?.status === 401 || error?.status === 403
  return (
    <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-err/20 bg-err-bg px-4 py-3 text-sm text-err">
      <span className="flex items-center gap-2">
        <MqAlertTriangle className="h-4 w-4 shrink-0" />
        {denied ? t('hq.denied') : `${t('hq.loadFailed')} ${errorText(error)}`}
      </span>
      {!denied && (
        <Button variant="outline" size="sm" onClick={onRetry}>
          <MqRefresh className="h-4 w-4" />
          {t('hq.retry')}
        </Button>
      )}
    </div>
  )
}

/** Label / value rows. */
export function Facts({ items }) {
  return (
    <dl className="divide-y divide-line text-sm">
      {items.map(([label, value]) => (
        <div key={typeof label === 'string' ? label : label.key} className="flex items-center justify-between gap-4 py-2.5">
          <dt className="text-muted">{label}</dt>
          <dd className="tnum text-end font-semibold">{value}</dd>
        </div>
      ))}
    </dl>
  )
}
