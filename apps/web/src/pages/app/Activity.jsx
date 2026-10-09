import { Card, EmptyState, MqLedger, Select, Skeleton } from '@mirqam/ui'
import { useState } from 'react'
import { PageHeader } from '../../components/AppShell.jsx'
import EntriesTable from '../../components/EntriesTable.jsx'
import Pagination from '../../components/Pagination.jsx'
import { useI18n } from '../../i18n/index.jsx'
import { useApi } from '../../lib/api.js'

const PAGE = 50
const KINDS = ['earn', 'redeem', 'adjust', 'void', 'expire']

export default function Activity() {
  const { t } = useI18n()
  const [kind, setKind] = useState('')
  const [programId, setProgramId] = useState('')
  const [offset, setOffset] = useState(0)
  const programs = useApi('/programs')
  const params = new URLSearchParams({ limit: String(PAGE), offset: String(offset) })
  if (kind) params.set('kind', kind)
  if (programId) params.set('programId', programId)
  const { data, loading } = useApi(`/ledger/entries?${params}`)
  const filter = (setter) => (e) => {
    setter(e.target.value)
    setOffset(0)
  }

  return (
    <>
      <PageHeader title={t('nav.activity')} subtitle={t('activity.subtitle')} />
      <Card bodyClass="">
        <div className="flex flex-wrap gap-3 border-b border-line p-4">
          <label className="w-full sm:w-52">
            <span className="sr-only">{t('activity.type')}</span>
            <Select value={kind} onChange={filter(setKind)}>
              <option value="">{t('activity.allTypes')}</option>
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {t(`kinds.${k}`)}
                </option>
              ))}
            </Select>
          </label>
          <label className="w-full sm:w-64">
            <span className="sr-only">{t('activity.program')}</span>
            <Select value={programId} onChange={filter(setProgramId)}>
              <option value="">{t('activity.allPrograms')}</option>
              {programs.data?.items.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </label>
        </div>
        {loading && !data ? (
          <Skeleton className="px-6" rows={2} />
        ) : data?.items.length ? (
          <>
            <EntriesTable items={data.items} />
            <Pagination total={data.total} limit={PAGE} offset={offset} onChange={setOffset} />
          </>
        ) : (
          <EmptyState icon={MqLedger} title={t('activity.emptyTitle')} desc={t('activity.emptyBody')} />
        )}
      </Card>
    </>
  )
}
