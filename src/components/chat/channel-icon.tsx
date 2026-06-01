import { Globe, MessageCircle, Send } from 'lucide-react'
import { zernioPlatform } from '@/lib/zernio/channel'

type ChannelIconProps = {
  channel: string
  className?: string
}

// Resolve a channel value to a logical platform for icon/label lookup.
// Handles native channels (instagram/messenger) and Zernio per-platform channels
// (zernio_instagram → instagram, zernio_facebook → facebook/messenger, …).
function resolvePlatform(channel: string): string {
  const zp = zernioPlatform(channel)
  if (zp) return zp === 'facebook' ? 'messenger' : zp
  return channel
}

function InstagramIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none" />
    </svg>
  )
}

function MessengerIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M12 2C6.477 2 2 6.145 2 11.25c0 2.921 1.408 5.53 3.625 7.274V22l3.338-1.836A11.17 11.17 0 0 0 12 20.5c5.523 0 10-4.145 10-9.25S17.523 2 12 2z" />
      <path d="m8 13 2.5-3 2 2.5L15 9" />
    </svg>
  )
}

export function ChannelIcon({ channel, className = 'h-4 w-4' }: ChannelIconProps) {
  const platform = resolvePlatform(channel)
  if (platform === 'instagram') return <InstagramIcon className={className} />
  if (platform === 'messenger') return <MessengerIcon className={className} />
  if (platform === 'whatsapp') return <MessageCircle className={className} />
  if (platform === 'telegram') return <Send className={className} />
  return <Globe className={className} />
}

/**
 * Pure helper | maps a channel value to a display label.
 * Used in tests and in the header UI.
 */
const PLATFORM_LABEL: Record<string, string> = {
  instagram: 'Instagram',
  facebook: 'Facebook',
  messenger: 'Messenger',
  whatsapp: 'WhatsApp',
  telegram: 'Telegram',
  linkedin: 'LinkedIn',
  tiktok: 'TikTok',
  twitter: 'X',
  threads: 'Threads',
  youtube: 'YouTube',
}

export function channelLabel(channel: string): string {
  // Zernio per-platform channels: label by the platform (Facebook keeps its
  // own name rather than collapsing into "Messenger").
  const zp = zernioPlatform(channel)
  if (zp) return PLATFORM_LABEL[zp] ?? 'Zernio'
  if (channel === 'instagram') return 'Instagram'
  if (channel === 'messenger') return 'Messenger'
  return 'Website Chat'
}

/**
 * Pure filter helper | used by ConversationList and testable without rendering.
 */
export type ChannelFilter = 'all' | 'widget' | 'instagram' | 'messenger'
export type BotStateFilter = 'all' | 'bot-active' | 'bot-paused'

export interface FilterableConversation {
  channel: string
  botStatus: string
  status: string
}

export function applyChannelAndBotFilter<T extends FilterableConversation>(
  conversations: T[],
  channelFilter: ChannelFilter,
  botStateFilter: BotStateFilter
): T[] {
  return conversations.filter((c) => {
    if (channelFilter !== 'all' && c.channel !== channelFilter) return false
    if (botStateFilter === 'bot-active' && c.botStatus !== 'active') return false
    if (botStateFilter === 'bot-paused' && c.botStatus !== 'paused') return false
    return true
  })
}
