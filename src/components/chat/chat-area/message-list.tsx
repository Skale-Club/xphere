'use client'

import { useEffect, useRef } from 'react'

import { ConversationMessage } from '@/types/chat'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { ScrollArea } from '@/components/ui/scroll-area'

interface MessageListProps {
  messages: ConversationMessage[]
  isLoading: boolean
  /** OBS-08: Maps agent_id → agent name for per-message badges. */
  agentMap?: Record<string, string>
}

function getDebugMessageStyle(message: ConversationMessage): string {
  const type = message.metadata?.type as string | undefined
  const severity = message.metadata?.severity as string | undefined

  if (type === 'tool_call') {
    return 'bg-blue-50/80 border-blue-200/50 text-blue-700 dark:bg-blue-950/30 dark:border-blue-800/50 dark:text-blue-300 shadow-sm'
  }
  if (type === 'tool_result') {
    return 'bg-green-50/80 border-green-200/50 text-green-700 dark:bg-green-950/30 dark:border-green-800/50 dark:text-green-300 shadow-sm'
  }
  if (type === 'error' || severity === 'error') {
    return 'bg-red-50/80 border-red-200/50 text-red-700 dark:bg-red-950/30 dark:border-red-800/50 dark:text-red-300 shadow-sm'
  }
  return 'bg-muted/50 text-muted-foreground shadow-sm'
}

/**
 * Scrollable message list. Renders visitor/assistant bubbles and
 * internal/debug messages with distinct styling. Auto-scrolls to bottom
 * when the messages array changes.
 */
export function MessageList({ messages, isLoading, agentMap }: MessageListProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  return (
    <ScrollArea className="flex-1 bg-neutral-50/50 dark:bg-neutral-900/20 px-4 py-6 md:px-8">
      {isLoading ? (
        <div className="flex items-center justify-center h-32 text-sm text-muted-foreground">
          Loading messages...
        </div>
      ) : messages.length === 0 ? (
        <div className="flex items-center justify-center h-32 text-sm text-muted-foreground">
          No messages yet.
        </div>
      ) : (
        <div className="space-y-6">
          {messages.map((message, i) => {
            const isInternal = !!message.metadata?.internal
            const previousMessage = i > 0 ? messages[i - 1] : null
            const isSequential = previousMessage && previousMessage.role === message.role && !isInternal && !previousMessage.metadata?.internal

            if (isInternal) {
              return (
                <div key={message.id} className="flex justify-center my-4 opacity-80 hover:opacity-100 transition-opacity">
                  <div
                    className={[
                      'rounded-xl border px-4 py-2 text-[11px] font-mono leading-relaxed max-w-[85%] text-left md:text-center',
                      getDebugMessageStyle(message),
                    ].join(' ')}
                  >
                    {message.content}
                  </div>
                </div>
              )
            }

            if (message.role === 'visitor') {
              return (
                <div key={message.id} className={`flex justify-end w-full group ${isSequential ? 'mt-1' : 'mt-6'}`}>
                  <div
                    className={`bg-indigo-600 text-white shadow-sm px-4 py-2.5 max-w-[85%] md:max-w-[70%] text-[15px] leading-relaxed transition-all
                      ${isSequential ? 'rounded-2xl rounded-tr-sm' : 'rounded-2xl'}
                    `}
                  >
                    {message.content}
                  </div>
                </div>
              )
            }

            // OBS-08: Resolve agent badge from metadata.agent_id
            const agentId = message.metadata?.agent_id as string | undefined
            const agentName = agentId ? (agentMap?.[agentId] ?? null) : null

            return (
              <div key={message.id} className={`flex items-end gap-3 w-full group ${isSequential ? 'mt-1' : 'mt-6'}`}>
                {!isSequential ? (
                  <Avatar className="h-8 w-8 shrink-0 shadow-sm border mb-1">
                    <AvatarFallback className="text-xs font-semibold bg-neutral-100 text-neutral-800">Op</AvatarFallback>
                  </Avatar>
                ) : (
                  <div className="h-8 w-8 shrink-0"></div>
                )}
                <div className="flex flex-col min-w-0">
                  <div
                    className={`bg-white dark:bg-neutral-800 text-foreground border shadow-sm px-4 py-2.5 max-w-[85%] md:max-w-[70%] text-[15px] leading-relaxed transition-all
                      ${isSequential ? 'rounded-2xl rounded-tl-sm' : 'rounded-2xl'}
                    `}
                  >
                    {message.content}
                  </div>
                  {agentName && (
                    <span className="text-[10px] text-muted-foreground mt-0.5 block">
                      via {agentName}
                    </span>
                  )}
                </div>
              </div>
            )
          })}
          <div ref={messagesEndRef} className="h-2" />
        </div>
      )}
    </ScrollArea>
  )
}
