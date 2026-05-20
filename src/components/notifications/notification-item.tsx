'use client'

import { useRouter } from 'next/navigation'
import { MessageCircle, PhoneMissed, AlertTriangle } from 'lucide-react'
import { formatDistanceToNowStrict } from 'date-fns'
import type { NotificationRow } from '@/app/(dashboard)/notifications/actions'

interface NotificationItemProps {
  notification: NotificationRow
  onRead: (id: string) => void
  onClose: () => void
}

function getNavigationTarget(notification: NotificationRow): string {
  const payload = notification.payload as Record<string, unknown>
  switch (notification.type) {
    case 'new_conversation':
      return `/chat?id=${payload.conversation_id ?? ''}`
    case 'missed_call':
      return `/calls?highlight=${payload.call_log_id ?? ''}`
    case 'flow_failed':
      return `/automations/logs?id=${payload.action_log_id ?? ''}`
    default:
      return '/'
  }
}

function getIcon(type: NotificationRow['type']) {
  switch (type) {
    case 'new_conversation':
      return <MessageCircle className="h-4 w-4 shrink-0 text-text-secondary" />
    case 'missed_call':
      return <PhoneMissed className="h-4 w-4 shrink-0 text-text-secondary" />
    case 'flow_failed':
      return <AlertTriangle className="h-4 w-4 shrink-0 text-text-secondary" />
  }
}

function getMessage(type: NotificationRow['type']): string {
  switch (type) {
    case 'new_conversation':
      return 'New conversation'
    case 'missed_call':
      return 'Missed call'
    case 'flow_failed':
      return 'Automation flow failed'
  }
}

export function NotificationItem({ notification, onRead, onClose }: NotificationItemProps) {
  const router = useRouter()

  const handleClick = async () => {
    onRead(notification.id)
    onClose()
    router.push(getNavigationTarget(notification))
  }

  const isUnread = !notification.read_at

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={handleClick}
      onKeyDown={(e) => e.key === 'Enter' && handleClick()}
      className={`
        flex cursor-pointer items-start gap-3 px-4 py-3
        hover:bg-bg-secondary motion-fast
        ${isUnread ? 'bg-bg-secondary' : 'opacity-60'}
      `}
    >
      <div className="mt-0.5">{getIcon(notification.type)}</div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-text-primary">{getMessage(notification.type)}</p>
        <p className="mt-0.5 text-xs text-text-tertiary">
          {formatDistanceToNowStrict(new Date(notification.created_at), { addSuffix: true })}
        </p>
      </div>
      {isUnread && (
        <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-accent" aria-hidden="true" />
      )}
    </div>
  )
}
