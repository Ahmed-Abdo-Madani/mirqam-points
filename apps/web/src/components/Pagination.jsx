import { Button } from '@mirqam/ui'
import { useI18n } from '../i18n/index.jsx'
import { num } from '../lib/format.js'

export default function Pagination({ total, limit, offset, onChange }) {
  const { t } = useI18n()
  if (total <= limit) return null
  const from = offset + 1
  const to = Math.min(offset + limit, total)
  return (
    <nav aria-label={t('common.pagination')} className="flex items-center justify-between gap-3 border-t border-line px-5 py-3 text-sm">
      <span className="tnum text-muted">{t('common.showing', { from: num(from), to: num(to), total: num(total) })}</span>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" disabled={offset === 0} onClick={() => onChange(Math.max(0, offset - limit))}>
          {t('common.previous')}
        </Button>
        <Button variant="outline" size="sm" disabled={to >= total} onClick={() => onChange(offset + limit)}>
          {t('common.next')}
        </Button>
      </div>
    </nav>
  )
}
