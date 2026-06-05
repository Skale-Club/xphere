import { MessageSquare, ShieldAlert, UserRound } from 'lucide-react'

import { getProspectReplies } from '../actions'
import { EntityPageTemplate } from '@/components/crm/entity-template'
import { PageContainer, PageHeader } from '@/components/layout/page-header'
import { Badge } from '@/components/ui/badge'

function statusLabel(value: string): string {
  return value.replaceAll('_', ' ')
}

export default async function ProspectRepliesPage() {
  const result = await getProspectReplies()

  return (
    <EntityPageTemplate scope={{ entity: 'prospect', lifecycleStage: 'prospect' }}>
      <PageContainer size="wide" className="h-full">
        <PageHeader
          eyebrow="Prospects"
          eyebrowIcon={result.ok ? MessageSquare : ShieldAlert}
          title="Replies"
          description="Prospects who engaged — replied, interested, or flagged for follow-up. Engagement never auto-promotes lifecycle stage."
        />

        {!result.ok ? (
          <div className="rounded-[12px] border border-border bg-bg-secondary px-4 py-8 text-[13px] text-text-secondary">
            {result.error}
          </div>
        ) : result.rows.length === 0 ? (
          <div className="rounded-[12px] border border-border bg-bg-secondary px-4 py-10 text-center text-[13px] text-text-secondary">
            No engaged prospects yet. Replies from outreach will surface here as engagement updates arrive.
          </div>
        ) : (
          <div className="rounded-[12px] border border-border bg-bg-secondary overflow-hidden">
            <div className="divide-y divide-border-subtle">
              {result.rows.map((row) => (
                <div key={row.id} className="flex items-center gap-3 px-4 py-3">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] bg-accent-muted text-accent">
                    <UserRound className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-medium text-text-primary">
                      {row.name || <span className="italic text-text-tertiary">Unnamed prospect</span>}
                    </div>
                    <div className="truncate text-[11.5px] text-text-tertiary">
                      {row.company || row.email || row.phone || 'Person prospect'}
                    </div>
                  </div>
                  <Badge variant="secondary" className="shrink-0 capitalize">
                    {statusLabel(row.engagementStatus)}
                  </Badge>
                </div>
              ))}
            </div>
          </div>
        )}
      </PageContainer>
    </EntityPageTemplate>
  )
}
