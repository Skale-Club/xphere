import { DownloadCloud, ShieldAlert } from 'lucide-react'

import { getProspectSources } from '../actions'
import { EntityPageTemplate } from '@/components/crm/entity-template'
import { PageContainer, PageHeader } from '@/components/layout/page-header'
import { Badge } from '@/components/ui/badge'

function relativeDate(iso: string): string {
  return new Date(iso).toLocaleString()
}

const STATUS_VARIANT: Record<string, 'secondary' | 'default' | 'destructive'> = {
  completed: 'secondary',
  running: 'default',
  pending: 'default',
  failed: 'destructive',
}

export default async function ProspectSourcesPage() {
  const result = await getProspectSources()

  return (
    <EntityPageTemplate scope={{ entity: 'prospect', lifecycleStage: 'prospect' }}>
      <PageContainer size="wide" className="h-full">
        <PageHeader
          eyebrow="Prospects"
          eyebrowIcon={result.ok ? DownloadCloud : ShieldAlert}
          title="Sources"
          description="Imports and scrape runs that created prospect-stage records, including Xcraper lists and API ingestion."
        />

        {!result.ok ? (
          <div className="rounded-[12px] border border-border bg-bg-secondary px-4 py-8 text-[13px] text-text-secondary">
            {result.error}
          </div>
        ) : result.sources.length === 0 ? (
          <div className="rounded-[12px] border border-border bg-bg-secondary px-4 py-10 text-center text-[13px] text-text-secondary">
            No import sources yet. Prospects pushed through the API or imported from a list will appear here.
          </div>
        ) : (
          <div className="rounded-[12px] border border-border bg-bg-secondary overflow-hidden">
            <div className="hidden grid-cols-[1.5fr_1fr_100px_90px_140px] items-center gap-3 border-b border-border-subtle px-4 py-2.5 text-[11px] font-medium uppercase tracking-wide text-text-tertiary sm:grid">
              <div>Source</div>
              <div>Run</div>
              <div>Status</div>
              <div className="text-right">Imported</div>
              <div className="text-right">When</div>
            </div>
            <div className="divide-y divide-border-subtle">
              {result.sources.map((s) => (
                <div
                  key={s.id}
                  className="grid grid-cols-1 items-center gap-3 px-4 py-3 sm:grid-cols-[1.5fr_1fr_100px_90px_140px]"
                >
                  <div className="min-w-0">
                    <div className="truncate text-[13px] font-medium text-text-primary">
                      {s.label || s.sourceType}
                    </div>
                    <div className="truncate text-[11.5px] text-text-tertiary">
                      {s.sourceKey || s.sourceType}
                    </div>
                  </div>
                  <div className="hidden truncate font-mono text-[11.5px] text-text-tertiary sm:block">
                    {s.externalRunId || '—'}
                  </div>
                  <div className="hidden sm:block">
                    <Badge variant={STATUS_VARIANT[s.status] ?? 'secondary'} className="capitalize">
                      {s.status}
                    </Badge>
                  </div>
                  <div className="hidden text-right text-[12.5px] tabular-nums text-text-secondary sm:block">
                    {s.importedCount}/{s.totalCount}
                  </div>
                  <div className="hidden text-right text-[11.5px] text-text-tertiary sm:block">
                    {relativeDate(s.createdAt)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </PageContainer>
    </EntityPageTemplate>
  )
}
