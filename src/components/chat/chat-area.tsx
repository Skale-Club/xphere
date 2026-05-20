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

import { useState } from 'react'
import { MessageSquare } from 'lucide-react'

import { ConversationSummary, ConversationMessage, ConversationPriority } from '@/types/chat'
import { ChatHeader } from '@/components/chat/chat-area/chat-header'
import { MessageList } from '@/components/chat/chat-area/message-list'
import { MessageBanner } from '@/components/chat/chat-area/message-banner'
import { MessageComposer } from '@/components/chat/chat-area/message-composer'
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
  /** "Agent thinking" — set while runAgent is processing. */
  isAgentThinking?: boolean
  onSendMessage: (content: string, opts?: { media?: Array<{ url: string; mime_type: string; filename?: string; size?: number }> }) => Promise<void>
  onTyping?: () => void
  onStatusChange: (status: 'open' | 'closed') => void
  onDelete: () => void
  onBack: () => void
  onBotStatusToggle: (conversationId: string, currentStatus: string) => void
  isBotToggling: boolean
  onPinToggle: (id: string, pinned: boolean) => void
  onPriorityCycle: (id: string, next: ConversationPriority) => void
  onAssign: (id: string, userId: string | null) => void
  members: OrgMember[]
  infoPanelOpen: boolean
  onToggleInfoPanel: () => void
  agentMap?: Record<string, string>
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
  members,
  infoPanelOpen,
  onToggleInfoPanel,
  agentMap,
}: ChatAreaProps) {
  const [showDebug, setShowDebug] = useState(false)

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

  const visibleMessages = messages.filter(
    (m) => showDebug || !m.metadata?.internal,
  )

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
        members={members}
        infoPanelOpen={infoPanelOpen}
        onToggleInfoPanel={onToggleInfoPanel}
        callPhone={conversation.visitorPhone ?? null}
      />

      {/* Internal/debug toggle — small, optional, off by default */}
      <div className="flex shrink-0 items-center justify-end gap-2 border-b border-border-subtle bg-bg-secondary/30 px-4 py-1.5">
        <label className="flex items-center gap-1.5 text-[11px] text-text-tertiary cursor-pointer">
          <input
            type="checkbox"
            checked={showDebug}
            onChange={(e) => setShowDebug(e.target.checked)}
            className="h-3 w-3 rounded border-border accent-accent"
          />
          Show internal messages
        </label>
      </div>

      <MessageList
        messages={visibleMessages}
        isLoading={isLoading}
        isTyping={isTyping}
        isAgentThinking={isAgentThinking}
        agentMap={agentMap}
      />
      <MessageBanner conversation={conversation} />
      <MessageComposer
        onSendMessage={onSendMessage}
        onTyping={onTyping}
        channelLabel={CHANNEL_LABEL[conversation.channel] ?? null}
        disabled={isBotActive}
        disabledHint={
          isBotActive
            ? 'Bot is active — pause it to send messages manually.'
            : undefined
        }
        onResumeManual={
          isBotActive
            ? () => onBotStatusToggle(conversation.id, conversation.botStatus)
            : undefined
        }
      />
    </div>
  )
}
