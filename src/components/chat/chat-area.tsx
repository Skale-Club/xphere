'use client'

import { useState } from 'react'
import { MessageSquare } from 'lucide-react'

import { ConversationSummary, ConversationMessage } from '@/types/chat'
import { ChatHeader } from '@/components/chat/chat-area/chat-header'
import { MessageList } from '@/components/chat/chat-area/message-list'
import { MessageBanner } from '@/components/chat/chat-area/message-banner'
import { MessageComposer } from '@/components/chat/chat-area/message-composer'

interface ChatAreaProps {
  conversation: ConversationSummary | null
  messages: ConversationMessage[]
  isLoading: boolean
  onSendMessage: (content: string) => Promise<void>
  onStatusChange: (status: 'open' | 'closed') => void
  onDelete: () => void
  onBack: () => void
  onBotStatusToggle: (conversationId: string, currentStatus: string) => void
  isBotToggling: boolean
  /** OBS-08: Maps agent_id → agent name for per-message agent badges. */
  agentMap?: Record<string, string>
}

/**
 * Chat detail pane orchestrator. Owns the empty-state branch and the
 * showDebug toggle (which filters messages before passing them to MessageList).
 * Composes ChatHeader, MessageList, MessageBanner, and MessageComposer with
 * the same layout structure as the original monolithic component.
 */
export function ChatArea({
  conversation,
  messages,
  isLoading,
  onSendMessage,
  onStatusChange,
  onDelete,
  onBack,
  onBotStatusToggle,
  isBotToggling,
  agentMap,
}: ChatAreaProps) {
  const [showDebug, setShowDebug] = useState(false)

  // Empty state
  if (!conversation) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center p-8">
        <MessageSquare className="h-16 w-16 opacity-20 mb-4" />
        <h3 className="text-lg font-medium mb-2">No conversation selected</h3>
        <p className="text-sm text-muted-foreground">
          Select a conversation from the list to view details.
        </p>
      </div>
    )
  }

  const visibleMessages = messages.filter(
    (m) => showDebug || !m.metadata?.internal
  )

  return (
    <div className="flex flex-col h-full">
      <ChatHeader
        conversation={conversation}
        onBack={onBack}
        onStatusChange={onStatusChange}
        onDelete={onDelete}
        onBotStatusToggle={onBotStatusToggle}
        isBotToggling={isBotToggling}
        showDebug={showDebug}
        onShowDebugChange={setShowDebug}
      />
      <MessageList messages={visibleMessages} isLoading={isLoading} agentMap={agentMap} />
      <MessageBanner conversation={conversation} />
      <MessageComposer onSendMessage={onSendMessage} />
    </div>
  )
}
