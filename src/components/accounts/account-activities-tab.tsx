import {
  Phone,
  FileText,
  ArrowRight,
  Plus,
  MessageSquare,
  Activity,
} from 'lucide-react'
import { relativeTime } from '@/lib/pipeline/format'

interface ActivityItem {
  id: string
  type: string
  content: string | null
  created_at: string
  opportunity_id: string
}

interface Props {
  activities: ActivityItem[]
}

function ActivityIcon({ type }: { type: string }) {
  const cls = 'h-4 w-4 flex-shrink-0 text-text-tertiary'
  switch (type) {
    case 'call':
      return <Phone className={cls} />
    case 'note':
      return <FileText className={cls} />
    case 'stage_change':
      return <ArrowRight className={cls} />
    case 'created':
      return <Plus className={cls} />
    case 'whatsapp':
    case 'sms':
    case 'instagram':
      return <MessageSquare className={cls} />
    default:
      return <Activity className={cls} />
  }
}

function truncate(text: string, max = 120): string {
  return text.length > max ? text.slice(0, max) + '…' : text
}

export function AccountActivitiesTab({ activities }: Props) {
  if (activities.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <p className="text-[15px] font-medium text-text-primary">No activities yet</p>
        <p className="mt-1 text-[13px] text-text-tertiary">
          No activities recorded for this company yet.
        </p>
      </div>
    )
  }

  return (
    <ul className="divide-y divide-border-subtle rounded-[10px] border border-border bg-bg-secondary">
      {activities.map((activity) => (
        <li
          key={activity.id}
          className="flex items-start gap-3 px-4 py-3 first:rounded-t-[10px] last:rounded-b-[10px]"
        >
          <span className="mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-bg-tertiary">
            <ActivityIcon type={activity.type} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[13px] text-text-primary">
              {truncate(activity.content ?? activity.type)}
            </p>
            <p className="mt-0.5 text-[11px] text-text-tertiary">
              {relativeTime(activity.created_at)}
            </p>
          </div>
          <span className="flex-shrink-0 rounded-full bg-bg-tertiary px-2 py-0.5 text-[11px] font-medium text-text-tertiary">
            {activity.type.replace('_', ' ')}
          </span>
        </li>
      ))}
    </ul>
  )
}
