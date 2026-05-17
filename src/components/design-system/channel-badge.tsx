import * as React from 'react'
import { MessageSquare, Phone, Camera, Send, Globe, MessageCircle } from 'lucide-react'

import { cn } from '@/lib/utils'

export type Channel =
  | 'whatsapp'
  | 'instagram'
  | 'messenger'
  | 'sms'
  | 'voice'
  | 'web'
  | 'unknown'

const channelMeta: Record<Channel, { label: string; icon: React.ComponentType<{ className?: string }>; bg: string; color: string }> = {
  whatsapp:  { label: 'WhatsApp',  icon: MessageCircle, bg: 'bg-[var(--ch-whatsapp)]/15',  color: 'text-[var(--ch-whatsapp)]' },
  instagram: { label: 'Instagram', icon: Camera,        bg: 'bg-[var(--ch-instagram)]/15', color: 'text-[var(--ch-instagram)]' },
  messenger: { label: 'Messenger', icon: MessageSquare, bg: 'bg-[var(--ch-messenger)]/15', color: 'text-[var(--ch-messenger)]' },
  sms:       { label: 'SMS',       icon: Send,          bg: 'bg-[var(--ch-sms)]/15',       color: 'text-[var(--ch-sms)]' },
  voice:     { label: 'Voice',     icon: Phone,         bg: 'bg-[var(--ch-voice)]/15',     color: 'text-[var(--ch-voice)]' },
  web:       { label: 'Web',       icon: Globe,         bg: 'bg-[var(--ch-web)]/15',       color: 'text-[var(--ch-web)]' },
  unknown:   { label: 'Channel',   icon: MessageSquare, bg: 'bg-bg-tertiary',              color: 'text-text-tertiary' },
}

interface ChannelBadgeProps {
  channel: Channel
  showLabel?: boolean
  size?: 'sm' | 'md'
  className?: string
}

export function ChannelBadge({ channel, showLabel = true, size = 'sm', className }: ChannelBadgeProps) {
  const meta = channelMeta[channel] ?? channelMeta.unknown
  const Icon = meta.icon

  if (!showLabel) {
    return (
      <span
        className={cn(
          'inline-flex items-center justify-center rounded-[5px]',
          size === 'sm' ? 'h-5 w-5' : 'h-6 w-6',
          meta.bg,
          meta.color,
          className,
        )}
        aria-label={meta.label}
      >
        <Icon className={size === 'sm' ? 'h-3 w-3' : 'h-3.5 w-3.5'} />
      </span>
    )
  }

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-[5px] px-1.5 py-0.5 text-[10.5px] font-medium tracking-tight',
        meta.bg,
        meta.color,
        className,
      )}
    >
      <Icon className="h-3 w-3" />
      <span>{meta.label}</span>
    </span>
  )
}
