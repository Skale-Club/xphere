import { ArrowLeftRight, Building2, ShieldAlert, UserRound } from 'lucide-react'

import { getProspectConversions } from '../actions'
import { EntityPageTemplate } from '@/components/crm/entity-template'
import { PageContainer, PageHeader } from '@/components/layout/page-header'
import { Badge } from '@/components/ui/badge'

function statusLabel(value: string): string {
  return value.replaceAll('_', ' ')
}

export default async function ProspectConversionsPage() {
  const result = await getProspectConversions()

  return (
    <EntityPageTemplate scope={{ entity: 'prospect', lifecycleStage: 'prospect' }}>
      <PageContainer size="wide" className="h-full">
        <PageHeader
          eyebrow="Prospects"
          eyebrowIcon={result.ok ? ArrowLeftRight : ShieldAlert}
          title="Conversions"
          description="History of every deliberate lifecycle change — when a prospect was promoted into the normal CRM."
        />

        {!result.ok ? (
          <div className="rounded-[12px] border border-border bg-bg-secondary px-4 py-8 text-[13px] text-text-secondary">
            {result.error}
          </div>
        ) : result.conversions.length === 0 ? (
          <div className="rounded-[12px] border border-border bg-bg-secondary px-4 py-10 text-center text-[13px] text-text-secondary">
            No conversions yet. Converting a prospect to a lead from the detail panel records it here.
          </div>
        ) : (
          <div className="rounded-[12px] border border-border bg-bg-secondary overflow-hidden">
            <div className="divide-y divide-border-subtle">
              {result.conversions.map((c) => (
                <div key={c.id} className="flex items-center gap-3 px-4 py-3">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] bg-accent-muted text-accent">
                    {c.entityType === 'account' ? <Building2 className="h-4 w-4" /> : <UserRound className="h-4 w-4" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-medium text-text-primary">
                      {c.entityName || <span className="italic text-text-tertiary">Unnamed {c.entityType}</span>}
                    </div>
                    <div className="flex items-center gap-1.5 text-[11.5px] text-text-tertiary">
                      <Badge variant="outline" className="capitalize">{statusLabel(c.fromStage)}</Badge>
                      <ArrowLeftRight className="h-3 w-3" />
                      <Badge variant="secondary" className="capitalize">{statusLabel(c.toStage)}</Badge>
                    </div>
                  </div>
                  <div className="shrink-0 text-right text-[11.5px] text-text-tertiary">
                    {new Date(c.createdAt).toLocaleString()}
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
