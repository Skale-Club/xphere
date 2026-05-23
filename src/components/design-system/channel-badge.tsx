import * as React from 'react'
import { Globe, Mail, MessageSquare } from 'lucide-react'

// Filled phone glyph (Material Design solid style) so the channel pill renders
// a solid shape instead of the outlined lucide variant.
function PhoneFilled({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
      <path d="M19.23 15.26l-2.54-.29c-.61-.07-1.21.14-1.64.57l-1.84 1.84c-2.83-1.44-5.15-3.75-6.59-6.59l1.85-1.85c.43-.43.64-1.03.57-1.64l-.29-2.52c-.12-1.01-.97-1.77-1.99-1.77H5.03c-1.13 0-2.07.94-2 2.07.53 8.54 7.36 15.36 15.89 15.89 1.13.07 2.07-.87 2.07-2v-1.73c.01-1.01-.75-1.86-1.76-1.98z" />
    </svg>
  )
}

// Filled SMS / message bubble glyph.
function SmsFilled({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
      <path d="M20 2H4c-1.1 0-1.99.9-1.99 2L2 22l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zM7 9h10v2H7V9zm6 5H7v-2h6v2zm4-6H7V6h10v2z" />
    </svg>
  )
}

import { cn } from '@/lib/utils'

export type Channel =
  | 'whatsapp'
  | 'instagram'
  | 'messenger'
  | 'sms'
  | 'voice'
  | 'email'
  | 'web'
  | 'unknown'

interface ChannelMeta {
  label: string
  logoPath?: string
  icon?: React.ComponentType<{ className?: string }>
  bg: string
  color: string
}

// When `logoPath` is set, the badge renders the brand SVG used in the
// integrations registry (`/logos/*.svg`). Falls back to a lucide icon for
// channels that don't map to a specific brand (web, unknown).
const channelMeta: Record<Channel, ChannelMeta> = {
  whatsapp:  { label: 'WhatsApp',  logoPath: '/logos/whatsapp.svg',  bg: 'bg-[var(--ch-whatsapp)]/15',  color: 'text-[var(--ch-whatsapp)]' },
  instagram: { label: 'Instagram', logoPath: '/logos/instagram.svg', bg: 'bg-[var(--ch-instagram)]/15', color: 'text-[var(--ch-instagram)]' },
  messenger: { label: 'Messenger', logoPath: '/logos/messenger.svg', bg: 'bg-[var(--ch-messenger)]/15', color: 'text-[var(--ch-messenger)]' },
  sms:       { label: 'SMS',       icon: SmsFilled,                  bg: 'bg-[var(--ch-sms)]/15',       color: 'text-[var(--ch-sms)]' },
  voice:     { label: 'Voice',     icon: PhoneFilled,                bg: 'bg-[var(--ch-voice)]/15',     color: 'text-[var(--ch-voice)]' },
  email:     { label: 'Email',     icon: Mail,                       bg: 'bg-[var(--ch-email)]/15',     color: 'text-[var(--ch-email)]' },
  web:       { label: 'Web',       icon: Globe,                      bg: 'bg-[var(--ch-web)]/15',       color: 'text-[var(--ch-web)]' },
  unknown:   { label: 'Channel',   icon: MessageSquare,              bg: 'bg-bg-tertiary',              color: 'text-text-tertiary' },
}

interface ChannelBadgeProps {
  channel: Channel
  showLabel?: boolean
  size?: 'sm' | 'md'
  className?: string
}

function ChannelGlyph({ meta, size }: { meta: ChannelMeta; size: 'sm' | 'md' }) {
  const iconClass = size === 'sm' ? 'h-3 w-3' : 'h-[18px] w-[18px]'
  if (meta.logoPath) {
    // eslint-disable-next-line @next/next/no-img-element
    return (
      <img
        src={meta.logoPath}
        alt={meta.label}
        className={cn(iconClass, 'object-contain')}
      />
    )
  }
  if (meta.icon) {
    const Icon = meta.icon
    return <Icon className={iconClass} />
  }
  return null
}

export function ChannelBadge({ channel, showLabel = true, size = 'sm', className }: ChannelBadgeProps) {
  const meta = channelMeta[channel] ?? channelMeta.unknown

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
        <ChannelGlyph meta={meta} size={size} />
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
      <ChannelGlyph meta={meta} size={size} />
      <span>{meta.label}</span>
    </span>
  )
}
