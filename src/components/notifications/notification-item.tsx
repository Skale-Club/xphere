'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { PhoneMissed, AlertTriangle, Phone, Bell, type LucideIcon } from 'lucide-react'
import { formatDistanceToNowStrict } from 'date-fns'
import { ChannelBadge, type Channel } from '@/components/design-system/channel-badge'
import { formatPhoneDisplay } from '@/lib/phone-numbers/format'
import { zernioPlatform } from '@/lib/zernio/channel'
import { cn } from '@/lib/utils'
import type { NotificationRow } from '@/app/(dashboard)/notifications/actions'

interface NotificationItemProps {
  notification: NotificationRow
  onRead: (id: string) => void
  onClose: () => void
}

type Payload = Record<string, unknown>

/** Read a non-empty trimmed string from an unknown payload value. */
function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined
}

const CHANNEL_LABEL: Record<Channel, string> = {
  whatsapp: 'WhatsApp',
  instagram: 'Instagram',
  messenger: 'Messenger',
  telegram: 'Telegram',
  sms: 'SMS',
  voice: 'Voice',
  email: 'Email',
  web: 'Website Chat',
  direct: 'Direct',
  unknown: 'Channel',
}

/**
 * Normalize a raw payload channel value (including Zernio per-platform channels
 * like `zernio_instagram`) to a known {@link Channel}, or null when unmapped.
 */
function resolveChannel(raw: string | undefined): Channel | null {
  if (!raw) return null
  const zp = zernioPlatform(raw)
  const base = zp ? (zp === 'facebook' ? 'messenger' : zp) : raw
  return base in CHANNEL_LABEL ? (base as Channel) : null
}

function getNavigationTarget(notification: NotificationRow): string {
  const payload = notification.payload as Payload
  switch (notification.type) {
    case 'new_conversation':
    case 'new_message':
      return `/inbox?conversation=${payload.conversation_id ?? ''}`
    case 'missed_call':
      return `/calls?highlight=${payload.call_log_id ?? ''}`
    case 'incoming_call':
      return '/calls'
    case 'flow_failed':
      return '/workflows/logs'
    default:
      return '/'
  }
}

/** A small tinted square holding a status icon, sized to align with ChannelBadge (md). */
function IconTile({
  icon: Icon,
  tone,
  pulse,
}: {
  icon: LucideIcon
  tone: 'danger' | 'accent' | 'warning' | 'muted'
  pulse?: boolean
}) {
  const toneClass = {
    danger: 'bg-[var(--danger)]/12 text-danger',
    accent: 'bg-accent-muted text-accent',
    warning: 'bg-[var(--warning)]/12 text-warning',
    muted: 'bg-bg-tertiary text-text-tertiary',
  }[tone]
  return (
    <span
      className={cn('inline-flex h-6 w-6 items-center justify-center rounded-[5px]', toneClass)}
      aria-hidden
    >
      <Icon className={cn('h-3.5 w-3.5', pulse && 'animate-pulse')} />
    </span>
  )
}

interface NotificationContent {
  /** Leading visual — a channel badge for messages, an icon tile otherwise. */
  tile: React.ReactNode
  /** Primary line: who/what (e.g. the contact name or "Missed call"). */
  title: string
  /** Secondary line: the substance — message preview, caller, or error reason. */
  detail?: string
  /** Short qualifier explaining why this notification fired. */
  reason: string
  /** Optional channel label shown in the meta row. */
  channelLabel?: string
  /** Live status label that replaces the relative time (e.g. "Ringing now"). */
  live?: string
}

/**
 * Derives a rich, reason-specific description from the notification's stored
 * payload. The payload already carries contact names, message previews, caller
 * numbers and error text — this surfaces them instead of a generic label.
 */
function describe(notification: NotificationRow): NotificationContent {
  const p = (notification.payload ?? {}) as Payload

  switch (notification.type) {
    case 'new_message':
    case 'new_conversation': {
      const isNew = notification.type === 'new_conversation'
      const channel = resolveChannel(str(p.channel))
      const preview = str(p.message_preview)
      return {
        tile: <ChannelBadge channel={channel ?? 'unknown'} showLabel={false} size="md" />,
        title: str(p.contact_name) ?? (isNew ? 'New conversation' : 'New message'),
        detail: preview ?? (isNew ? 'Started a new conversation' : 'Sent a new message'),
        reason: isNew ? 'New conversation' : 'New message',
        channelLabel: channel ? CHANNEL_LABEL[channel] : undefined,
      }
    }

    case 'missed_call': {
      const name = str(p.caller_name)
      const num = str(p.customer_number) ?? str(p.caller_number)
      const who = name ?? (num ? formatPhoneDisplay(num) : undefined)
      return {
        tile: <IconTile icon={PhoneMissed} tone="danger" />,
        title: 'Missed call',
        detail: who ? `from ${who}` : 'A caller hung up before connecting',
        reason: 'Missed call',
        channelLabel: 'Voice',
      }
    }

    case 'incoming_call': {
      const name = str(p.caller_name)
      const num = str(p.caller_number)
      const formatted = num ? formatPhoneDisplay(num) : undefined
      const detail =
        name && formatted ? `${name} · ${formatted}` : `from ${name ?? formatted ?? 'Unknown caller'}`
      return {
        tile: <IconTile icon={Phone} tone="accent" pulse />,
        title: 'Incoming call',
        detail,
        reason: 'Incoming call',
        channelLabel: 'Voice',
        live: 'Ringing now',
      }
    }

    case 'flow_failed': {
      const name = str(p.flow_name) ?? str(p.workflow_name)
      return {
        tile: <IconTile icon={AlertTriangle} tone="warning" />,
        title: name ? `${name} failed` : 'Workflow failed',
        detail: str(p.error) ?? 'An automation step returned an error',
        reason: 'Automation error',
      }
    }

    default:
      return {
        tile: <IconTile icon={Bell} tone="muted" />,
        title: 'Notification',
        reason: 'Update',
      }
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
  const content = describe(notification)
  const createdAt = new Date(notification.created_at)

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
      <div className="mt-0.5 shrink-0">{content.tile}</div>

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-text-primary">{content.title}</p>

        {content.detail && (
          <p className="mt-0.5 line-clamp-2 text-xs text-text-secondary">{content.detail}</p>
        )}

        <div className="mt-1 flex flex-wrap items-center gap-x-1.5 text-[11px] text-text-tertiary">
          <span className="font-medium text-text-secondary">{content.reason}</span>
          {content.channelLabel && (
            <>
              <span aria-hidden>·</span>
              <span>{content.channelLabel}</span>
            </>
          )}
          <span aria-hidden>·</span>
          {content.live ? (
            <span className="font-medium text-accent">{content.live}</span>
          ) : (
            <time dateTime={notification.created_at} title={createdAt.toLocaleString()}>
              {formatDistanceToNowStrict(createdAt, { addSuffix: true })}
            </time>
          )}
        </div>
      </div>

      {isUnread && (
        <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-accent" aria-hidden="true" />
      )}
    </div>
  )
}
