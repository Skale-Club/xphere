import Link from 'next/link'
import { Button } from '@/components/ui/button'
import type { OpportunityWithStage } from '@/app/(dashboard)/accounts/[id]/actions'
import { formatCurrency, relativeTime } from '@/lib/pipeline/format'

interface Props {
  opportunities: OpportunityWithStage[]
  accountId: string
}

function statusClass(status: string): string {
  if (status === 'won') return 'bg-blue-500/15 text-blue-400'
  if (status === 'lost') return 'bg-red-500/15 text-red-400'
  return 'bg-green-500/15 text-green-400'
}

function statusLabel(status: string): string {
  if (status === 'won') return 'Won'
  if (status === 'lost') return 'Lost'
  return 'Open'
}

export function AccountOpportunitiesTab({ opportunities, accountId: _accountId }: Props) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-[13px] text-text-tertiary">
          {opportunities.length} {opportunities.length === 1 ? 'opportunity' : 'opportunities'}
        </p>
        <Button
          asChild
          variant="secondary"
          size="sm"
          id="add-opportunity-btn"
        >
          <Link href="#">Add opportunity</Link>
        </Button>
      </div>

      {opportunities.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <p className="text-[15px] font-medium text-text-primary">No opportunities linked yet</p>
          <p className="mt-1 text-[13px] text-text-tertiary">
            No opportunities linked to this company yet.
          </p>
        </div>
      ) : (
        <div className="divide-y divide-border-subtle rounded-[10px] border border-border bg-bg-secondary">
          {opportunities.map((opp) => (
            <Link
              key={opp.id}
              href={`/pipeline/${opp.id}`}
              className="flex items-center gap-4 px-4 py-3 transition-colors hover:bg-bg-tertiary first:rounded-t-[10px] last:rounded-b-[10px]"
            >
              {/* Stage dot + name */}
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <div className="flex items-center gap-2">
                  <span
                    className="h-2 w-2 flex-shrink-0 rounded-full"
                    style={{ backgroundColor: opp.stage?.color ?? '#6b7280' }}
                  />
                  <span className="truncate text-[13px] text-text-tertiary">
                    {opp.stage?.name ?? 'Unknown stage'}
                  </span>
                </div>
                <span className="truncate text-[14px] font-medium text-text-primary">
                  {opp.title}
                </span>
              </div>

              {/* Value */}
              <span className="flex-shrink-0 font-mono text-[13px] tabular-nums text-accent">
                {formatCurrency(Number(opp.value), opp.currency)}
              </span>

              {/* Status pill */}
              <span
                className={`flex-shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${statusClass(opp.status)}`}
              >
                {statusLabel(opp.status)}
              </span>

              {/* Relative time */}
              <span className="flex-shrink-0 text-[12px] text-text-tertiary">
                {relativeTime(opp.updated_at)}
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
