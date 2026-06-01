'use client'

/**
 * Redesigned chat-area orchestrator (v2.2 / SEED-011).
 *
 * Composes ChatHeader, MessageList, MessageBanner, and MessageComposer.
 * Empty-state uses the design-system EmptyState component.
 *
 * The actual data flow (messages, sending, realtime) is owned by ChatLayout.
 * This file is presentation glue + the empty branch.
 */

import { useEffect, useMemo, useState } from 'react'
import { MessageSquare, PhoneOff } from 'lucide-react'

import {
  ConversationSummary,
  ConversationMessage,
  ConversationPriority,
  ConversationStatus,
  ConversationLabel,
} from '@/types/chat'
import { ChatHeader } from '@/components/chat/chat-area/chat-header'
import { MessageList } from '@/components/chat/chat-area/message-list'
import { MessageBanner } from '@/components/chat/chat-area/message-banner'
import {
  MessageComposer,
  type ComposerChannel,
} from '@/components/chat/chat-area/message-composer'
import { SendTemplateDialog } from '@/components/chat/chat-area/send-template-dialog'
import { EmptyState } from '@/components/empty-states/empty-state'
import type { OrgMember } from '@/app/(dashboard)/chat/actions'
import { getContact } from '@/app/(dashboard)/contacts/actions'
import { DND_CHANNEL_LABELS } from '@/lib/dnd'

const CHANNEL_LABEL: Record<string, string> = {
  whatsapp: 'WhatsApp',
  ghl_whatsapp: 'WhatsApp',
  instagram: 'Instagram',
  messenger: 'Messenger',
  sms: 'SMS',
  ghl_sms: 'SMS',
  voice: 'Voice',
  email: 'Email',
  widget: 'Web',
  web: 'Web',
  manual: 'Direct',
  zernio_instagram: 'Instagram',
  zernio_facebook: 'Facebook',
  zernio_whatsapp: 'WhatsApp',
  zernio_telegram: 'Telegram',
  zernio_linkedin: 'LinkedIn',
  zernio_tiktok: 'TikTok',
  zernio_twitter: 'X',
  zernio_threads: 'Threads',
  zernio_youtube: 'YouTube',
}

const DELIVERABLE_CHANNELS = new Set([
  'sms',
  'ghl_sms',
  'whatsapp',
  'ghl_whatsapp',
  'instagram',
  'messenger',
  'email',
  'widget',
  'web',
  // Zernio per-platform channels are replyable on their own thread.
  'zernio',
  'zernio_instagram',
  'zernio_facebook',
  'zernio_whatsapp',
  'zernio_telegram',
  'zernio_linkedin',
  'zernio_tiktok',
  'zernio_twitter',
  'zernio_threads',
  'zernio_youtube',
])

const PRIORITY_CYCLE: Record<ConversationPriority, ConversationPriority> = {
  normal: 'high',
  high: 'urgent',
  urgent: 'normal',
}

function channelLabel(channel: string): string {
  return CHANNEL_LABEL[channel] ?? channel
}

interface ChatAreaProps {
  conversation: ConversationSummary | null
  messages: ConversationMessage[]
  isLoading: boolean
  /** Typing indicator from the other party (Realtime broadcast). */
  isTyping?: boolean
  /** "Agent thinking" | set while runAgent is processing. */
  isAgentThinking?: boolean
  onSendMessage: (
    content: string,
    opts?: {
      media?: Array<{ url: string; mime_type: string; filename?: string; size?: number }>
      /** SEED-039: explicit channel override. */
      channel?: string
      /** SEED-039: send through another open conversation for the same contact. */
      conversationId?: string
      /** Email channel: subject line for the outbound email. */
      subject?: string
    },
  ) => Promise<void>
  onTyping?: () => void
  /** SEED-035: accepts 5 status values plus optional wait_until ISO string. */
  onStatusChange: (status: ConversationStatus, waitUntil?: string | null) => void
  onDelete: () => void
  onBack: () => void
  onBotStatusToggle: (conversationId: string, currentStatus: string) => void
  isBotToggling: boolean
  onPinToggle: (id: string, pinned: boolean) => void
  onPriorityCycle: (id: string, next: ConversationPriority) => void
  onAssign: (id: string, userId: string | null) => void
  /** SEED-035 */
  onStarToggle?: (id: string, starred: boolean) => void
  /** SEED-035 */
  orgLabels?: Array<{ id: string; name: string; color: string }>
  /** SEED-035 */
  onLabelsChange?: (id: string, labels: ConversationLabel[]) => void
  members: OrgMember[]
  infoPanelOpen: boolean
  onToggleInfoPanel: () => void
  agentMap?: Record<string, string>
  /** False when this channel has no default AI agent configured. */
  botAgentAvailable?: boolean
  /** SEED-039: channels this contact can be reached on (for composer Select). */
  composerChannels?: ComposerChannel[]
  /**
   * When set (and there is no selected conversation), the empty state reflects
   * "this contact has no conversations yet" instead of the generic picker.
   * Used when arriving via /chat?contact=ID for a contact with no thread.
   */
  emptyContactId?: string | null
  /** True while a conversation is being auto-created for the contact. */
  isStartingConversation?: boolean
  /** Pagination: callback to load older messages. */
  onLoadMore?: () => void
  /** Pagination: true when there are older messages to load. */
  hasMore?: boolean
  /** Pagination: true while older messages are being fetched. */
  isLoadingMore?: boolean
}

export function ChatArea({
  conversation,
  messages,
  isLoading,
  isTyping = false,
  isAgentThinking = false,
  onSendMessage,
  onTyping,
  onStatusChange,
  onDelete,
  onBack,
  onBotStatusToggle,
  isBotToggling,
  onPinToggle,
  onPriorityCycle,
  onAssign,
  onStarToggle,
  orgLabels,
  onLabelsChange,
  members,
  infoPanelOpen,
  onToggleInfoPanel,
  agentMap,
  botAgentAvailable = true,
  composerChannels,
  emptyContactId,
  isStartingConversation = false,
  onLoadMore,
  hasMore = false,
  isLoadingMore = false,
}: ChatAreaProps) {
  const [showDebug, setShowDebug] = useState(false)
  // SEED-039: per-thread channel filter (client-side, no refetch).
  const [channelFilter, setChannelFilter] = useState<string[] | null>(null)
  // SEED-039: operator-selected outbound channel for the composer.
  const [activeChannel, setActiveChannel] = useState<string | null>(null)
  const [contactChannels, setContactChannels] = useState<ComposerChannel[]>([])
  const [contactChannelsLoaded, setContactChannelsLoaded] = useState(false)
  // Phase 1085 DND: track contact DND state to block composer.
  const [contactDnd, setContactDnd] = useState<{ enabled: boolean; channels: string[] }>({ enabled: false, channels: [] })
  const [templateDialogOpen, setTemplateDialogOpen] = useState(false)

  // WhatsApp Cloud template support: available when the conversation is via
  // meta_cloud. Outside the 24h customer service window, free text fails;
  // the composer banner pushes the user toward the template path.
  const templateAvailable = conversation?.channelMetadata?.provider === 'meta_cloud'
  const lastInboundAt = conversation?.lastInboundAt ?? null
  const outsideWindow = useMemo(() => {
    if (!templateAvailable) return false
    if (!lastInboundAt) return true // no inbound ever ⇒ no open service window
    return Date.now() - new Date(lastInboundAt).getTime() > 24 * 60 * 60 * 1000
  }, [templateAvailable, lastInboundAt])

  // SEED-039: derive distinct channels present in the thread (for filter UI).
  // Must be declared before any early return to satisfy Rules of Hooks.
  const threadChannels = useMemo(() => {
    const set = new Set<string>()
    for (const m of messages) {
      const ch =
        (m.channel as string | null | undefined) ??
        ((m.metadata as Record<string, unknown> | null | undefined)?.channel as string | undefined) ??
        null
      if (ch) set.add(ch)
    }
    return Array.from(set)
  }, [messages])

  useEffect(() => {
    setActiveChannel(null)
  }, [conversation?.id])

  useEffect(() => {
    let cancelled = false
    setContactChannels([])
    setContactChannelsLoaded(false)
    setContactDnd({ enabled: false, channels: [] })
    if (!conversation?.contactId) {
      setContactChannelsLoaded(true)
      return
    }

    getContact(conversation.contactId).then((contact) => {
      if (cancelled) return
      if (!contact) {
        setContactChannelsLoaded(true)
        return
      }
      const openChannels = contact.conversations
        .filter((c) => c.status === 'open' || c.status === 'pending' || c.status === 'waiting')
        .map((c) => ({
          channel: c.channel,
          label: channelLabel(c.channel),
          conversationId: c.id,
        }))
      setContactChannels(openChannels)
      setContactChannelsLoaded(true)
      // Phase 1085 DND: surface contact DND state in the composer.
      if (contact.dnd_enabled) {
        setContactDnd({ enabled: true, channels: contact.dnd_channels ?? [] })
      }
    }).catch(() => {
      if (!cancelled) setContactChannelsLoaded(true)
    })

    return () => {
      cancelled = true
    }
  }, [conversation?.contactId])

  const composerChannelOptions = useMemo(() => {
    if (!conversation) return []
    const byChannel = new Map<string, ComposerChannel>()
    const add = (channel: string, label = channelLabel(channel), conversationId?: string) => {
      if (!byChannel.has(channel)) byChannel.set(channel, { channel, label, conversationId })
    }

    add(conversation.channel, channelLabel(conversation.channel), conversation.id)
    for (const ch of composerChannels ?? []) add(ch.channel, ch.label, ch.conversationId)
    for (const ch of contactChannels) add(ch.channel, ch.label, ch.conversationId)

    return Array.from(byChannel.values())
  }, [composerChannels, contactChannels, conversation])

  if (!conversation) {
    return (
      <div className="flex h-full min-h-0 min-w-0 flex-col items-center justify-center overflow-hidden bg-bg-primary px-6">
        {isStartingConversation ? (
          <EmptyState
            icon={MessageSquare}
            title="Starting conversation…"
            description="Setting up the inbox for this contact."
            className="max-w-md"
          />
        ) : emptyContactId ? (
          <EmptyState
            icon={MessageSquare}
            title="No conversations yet"
            description="This contact doesn't have any conversations yet. Once a message is exchanged on any connected channel, the thread will appear here."
            className="max-w-md"
          />
        ) : (
          <EmptyState
            icon={MessageSquare}
            title="Pick a conversation"
            description="Select a conversation on the left to start chatting. Customer messages from any connected channel land in your inbox here."
            secondary={{ label: 'Open command palette (⌘K)', onClick: () => {} }}
            className="max-w-md"
          />
        )}
      </div>
    )
  }

  const visibleMessages = messages.filter((m) => {
    if (!showDebug && m.metadata?.internal) return false
    if (channelFilter && channelFilter.length > 0) {
      const ch =
        (m.channel as string | null | undefined) ??
        ((m.metadata as Record<string, unknown> | null | undefined)?.channel as string | undefined) ??
        conversation.channel
      if (!ch || !channelFilter.includes(ch)) return false
    }
    return true
  })

  const isBotActive = botAgentAvailable && conversation.botStatus === 'active'

  // Phase 1085 DND: determine if the active channel is DND-blocked.
  const activeChannelForDnd = activeChannel ?? conversation.channel
  // Map conversation channel to a DND channel key
  const channelToDndKey: Record<string, string> = {
    sms: 'sms', ghl_sms: 'sms',
    email: 'email',
    whatsapp: 'whatsapp', ghl_whatsapp: 'whatsapp',
    voice: 'calls',
  }
  const dndKey = channelToDndKey[activeChannelForDnd] ?? activeChannelForDnd
  const isDndBlocked = contactDnd.enabled && (
    contactDnd.channels.includes('all') || contactDnd.channels.includes(dndKey)
  )
  const dndBlockedChannelLabel = contactDnd.channels.includes('all')
    ? 'all channels'
    : contactDnd.channels.map((c) => DND_CHANNEL_LABELS[c] ?? c).join(', ')
  const hasDeliverableChannel = composerChannelOptions.some((ch) =>
    DELIVERABLE_CHANNELS.has(ch.channel),
  )
  const noAvailableOutboundChannel =
    contactChannelsLoaded && !hasDeliverableChannel

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-bg-primary">
      <ChatHeader
        conversation={conversation}
        onBack={onBack}
        onStatusChange={onStatusChange}
        onDelete={onDelete}
        onBotStatusToggle={onBotStatusToggle}
        isBotToggling={isBotToggling}
        onPinToggle={onPinToggle}
        onPriorityCycle={onPriorityCycle}
        onAssign={onAssign}
        onStarToggle={onStarToggle}
        orgLabels={orgLabels}
        onLabelsChange={onLabelsChange}
        members={members}
        infoPanelOpen={infoPanelOpen}
        onToggleInfoPanel={onToggleInfoPanel}
        callPhone={conversation.visitorPhone ?? null}
        threadChannels={threadChannels}
        channelFilter={channelFilter}
        onChannelFilterChange={setChannelFilter}
        showDebug={showDebug}
        onToggleDebug={() => setShowDebug((v) => !v)}
        dndEnabled={contactDnd.enabled}
        dndChannels={contactDnd.channels}
      />

      <MessageList
        key={conversation.id}
        messages={visibleMessages}
        isLoading={isLoading}
        isTyping={isTyping}
        isAgentThinking={isAgentThinking}
        agentMap={agentMap}
        primaryChannel={conversation.channel}
        noAvailableChannel={noAvailableOutboundChannel}
        onLoadMore={onLoadMore}
        hasMore={hasMore}
        isLoadingMore={isLoadingMore}
        visitorInitial={
          (conversation.contactName || conversation.visitorName || conversation.visitorPhone || '')
            .replace(/[^a-zA-Z0-9]/g, '')
            .charAt(0)
            .toUpperCase() || '?'
        }
      />
      <MessageBanner conversation={conversation} />
      {/* Phase 1085 DND: banner when this channel is blocked for the contact */}
      {isDndBlocked && (
        <div className="flex items-center gap-2 border-t border-rose-500/20 bg-rose-500/10 px-4 py-2 text-[12px] text-rose-400">
          <PhoneOff className="h-3.5 w-3.5 shrink-0" />
          <span>DND active — outbound {dndBlockedChannelLabel} blocked for this contact.</span>
        </div>
      )}
      <MessageComposer
        onSendMessage={onSendMessage}
        onTyping={onTyping}
        channelLabel={channelLabel(activeChannel ?? conversation.channel)}
        disabled={isBotActive || isDndBlocked || noAvailableOutboundChannel}
        disabledHint={
          noAvailableOutboundChannel
            ? 'Activate SMS, WhatsApp, or Email before sending a message.'
            : isDndBlocked
            ? `DND active — outbound ${dndBlockedChannelLabel} blocked for this contact.`
            : isBotActive
            ? 'Bot is active | pause it to send messages manually.'
            : undefined
        }
        onResumeManual={
          isBotActive && !isDndBlocked && !noAvailableOutboundChannel
            ? () => onBotStatusToggle(conversation.id, conversation.botStatus)
            : undefined
        }
        availableChannels={composerChannelOptions}
        activeChannel={activeChannel ?? conversation.channel}
        onActiveChannelChange={setActiveChannel}
        priority={conversation.priority ?? 'normal'}
        onPriorityCycle={() => onPriorityCycle(
          conversation.id,
          PRIORITY_CYCLE[conversation.priority ?? 'normal'],
        )}
        templateSupport={
          templateAvailable ? { available: true, outsideWindow } : undefined
        }
        onSendTemplate={() => setTemplateDialogOpen(true)}
      />
      {templateAvailable && (
        <SendTemplateDialog
          open={templateDialogOpen}
          onOpenChange={setTemplateDialogOpen}
          conversationId={conversation.id}
        />
      )}
    </div>
  )
}
