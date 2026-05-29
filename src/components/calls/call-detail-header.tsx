import { format } from 'date-fns'
import type { Database } from '@/types/database'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

type CallRow = Database['public']['Tables']['calls']['Row']

function formatDuration(seconds: number | null): string {
  if (seconds === null) return '-'
  return Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0')
}

function formatCallType(callType: string | null): string {
  if (!callType) return '-'
  switch (callType) {
    case 'inboundPhoneCall':
      return 'Inbound'
    case 'outboundPhoneCall':
      return 'Outbound'
    case 'webCall':
      return 'Web'
    default:
      return callType
  }
}

function EndedReasonBadge({ reason }: { reason: string | null }) {
  if (!reason) return <span className="text-muted-foreground">-</span>

  let className = 'bg-zinc-500/15 text-zinc-400'
  if (reason === 'customer-ended-call' || reason === 'assistant-ended-call') {
    className = 'bg-emerald-500/15 text-emerald-400'
  } else if (reason.includes('error') || reason === 'pipeline-error') {
    className = 'bg-red-500/15 text-red-400'
  }

  return (
    <Badge variant="outline" className={className}>
      {reason}
    </Badge>
  )
}

interface CallDetailHeaderProps {
  call: CallRow
}

export function CallDetailHeader({ call }: CallDetailHeaderProps) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">
          {call.customer_name ?? call.customer_number ?? 'Unknown Caller'}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3 text-sm">
          <div>
            <dt className="text-muted-foreground">Date</dt>
            <dd>
              {call.started_at
                ? format(new Date(call.started_at), 'MMM d, yyyy HH:mm')
                : '-'}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Duration</dt>
            <dd className="font-mono">{formatDuration(call.duration_seconds)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Cost</dt>
            <dd className="font-mono">
              {call.cost != null ? `$${call.cost.toFixed(6)}` : '-'}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Type</dt>
            <dd>{formatCallType(call.call_type)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Status</dt>
            <dd>
              <EndedReasonBadge reason={call.ended_reason} />
            </dd>
          </div>
          {call.customer_number && (
            <div>
              <dt className="text-muted-foreground">Phone</dt>
              <dd>{call.customer_number}</dd>
            </div>
          )}
        </dl>
        {call.summary && (
          <div className="mt-4 pt-4 border-t">
            <p className="text-xs text-muted-foreground mb-1">Summary</p>
            <p className="text-sm">{call.summary}</p>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
