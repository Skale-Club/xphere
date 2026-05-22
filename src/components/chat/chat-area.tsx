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

import { useMemo, useState } from 'react'
import { MessageSquare } from 'lucide-react'

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
import { EmptyState } from '@/components/empty-states/empty-state'
import type { OrgMember } from '@/app/(dashboard)/chat/actions'

const CHANNEL_LABEL: Record<string, string> = {
  whatsapp: 'WhatsApp',
  instagram: 'Instagram',
  messenger: 'Messenger',
  sms: 'SMS',
  voice: 'Voice',
  widget: 'Web',
  web: 'Web',
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
  /** SEED-039: channels this contact can be reached on (for composer Select). */
  composerChannels?: ComposerChannel[]
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
  composerChannels,
}: ChatAreaProps) {
  const [showDebug, setShowDebug] = useState(false)
  // SEED-039: per-thread channel filter (client-side, no refetch).
  const [channelFilter, setChannelFilter] = useState<string[] | null>(null)
  // SEED-039: operator-selected outbound channel for the composer.
  const [activeChannel, setActiveChannel] = useState<string | null>(null)

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

  if (!conversation) {
    return (
      <div className="flex h-full min-h-0 min-w-0 flex-col items-center justify-center overflow-hidden bg-bg-primary px-6">
        <EmptyState
          icon={MessageSquare}
          title="Pick a conversation"
          description="Select a conversation on the left to start chatting. Customer messages from any connected channel land in your inbox here."
          secondary={{ label: 'Open command palette (⌘K)', onClick: () => {} }}
          className="max-w-md"
        />
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

  const isBotActive = conversation.botStatus === 'active'

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
      />

      <MessageList
        messages={visibleMessages}
        isLoading={isLoading}
        isTyping={isTyping}
        isAgentThinking={isAgentThinking}
        agentMap={agentMap}
        primaryChannel={conversation.channel}
      />
      <MessageBanner conversation={conversation} />
      <MessageComposer
        onSendMessage={onSendMessage}
        onTyping={onTyping}
        channelLabel={CHANNEL_LABEL[conversation.channel] ?? null}
        disabled={isBotActive}
        disabledHint={
          isBotActive
            ? 'Bot is active | pause it to send messages manually.'
            : undefined
        }
        onResumeManual={
          isBotActive
            ? () => onBotStatusToggle(conversation.id, conversation.botStatus)
            : undefined
        }
        availableChannels={composerChannels}
        activeChannel={activeChannel ?? conversation.channel}
        onActiveChannelChange={setActiveChannel}
      />
    </div>
  )
}
