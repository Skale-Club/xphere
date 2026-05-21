'use client'

/**
 * Redesigned message list (v2.2 / SEED-011).
 *
 * Layout:
 *   - Customer messages: left-aligned, bg-bg-secondary, max-width 70%
 *   - Bot/admin messages: right-aligned, bg-accent-muted, max-width 70%
 *   - System messages: centered subtle pill
 *   - Tool-call / tool-result: small inline cards
 *   - Avatar shown only on the first bubble of a sequence (8px gap when stacked)
 *   - Hover surfaces timestamp + agent-via badge
 *
 * Scroll behaviour:
 *   - Stick to bottom when user is "near bottom" (within 80px).
 *   - When the user scrolls up and a new message arrives, surface a
 *     "New messages" pill anchored bottom-right that scrolls back when clicked.
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ChevronDown, Info } from 'lucide-react'

import { ConversationMessage, MediaAttachment } from '@/types/chat'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { cn } from '@/lib/utils'
import { MediaBlock } from './media-block'

interface MessageListProps {
  messages: ConversationMessage[]
  isLoading: boolean
  /** When true, render the "typing…" indicator at the bottom. */
  isTyping?: boolean
  /** When true, render an "Agent thinking…" inline near the bottom. */
  isAgentThinking?: boolean
  /** OBS-08: Maps agent_id → agent name for per-message badges. */
  agentMap?: Record<string, string>
  /** SEED-039: primary channel of the conversation for per-message badge fallback. */
  primaryChannel?: string
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString(undefined, {
      hour: 'numeric',
      minute: '2-digit',
    })
  } catch {
    return ''
  }
}

function isSystemMessage(m: ConversationMessage): boolean {
  return m.role === 'system' || m.metadata?.type === 'bot_toggle' || m.metadata?.system === true
}

function getDebugStyle(m: ConversationMessage): string | null {
  const type = m.metadata?.type as string | undefined
  const severity = m.metadata?.severity as string | undefined
  if (type === 'tool_call')   return 'border-info/30 bg-info/5 text-info'
  if (type === 'tool_result') return 'border-success/30 bg-success/5 text-success'
  if (type === 'error' || severity === 'error')
                              return 'border-danger/30 bg-danger/5 text-danger'
  return null
}

export function MessageList({
  messages,
  isLoading,
  isTyping = false,
  isAgentThinking = false,
  agentMap,
}: MessageListProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const endRef = useRef<HTMLDivElement>(null)
  const [hasNew, setHasNew] = useState(false)
  const [atBottom, setAtBottom] = useState(true)
  const lastMessageIdRef = useRef<string | null>(null)
  const prevCountRef = useRef(0)

  // Track "is the user near the bottom?" via scroll position on the viewport.
  useEffect(() => {
    const viewport = scrollRef.current?.querySelector(
      '[data-radix-scroll-area-viewport]',
    ) as HTMLElement | null
    if (!viewport) return
    const onScroll = () => {
      const dist = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight
      const isNear = dist < 80
      setAtBottom(isNear)
      if (isNear) setHasNew(false)
    }
    viewport.addEventListener('scroll', onScroll, { passive: true })
    onScroll()
    return () => viewport.removeEventListener('scroll', onScroll)
  }, [])

  // Auto-scroll when messages array changes | but only if the user is already
  // at the bottom. Otherwise surface the "new messages" pill.
  useLayoutEffect(() => {
    const grew = messages.length > prevCountRef.current
    const lastId = messages[messages.length - 1]?.id ?? null
    const newLast = lastId !== lastMessageIdRef.current
    if (grew && newLast) {
      if (atBottom) {
        endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
      } else {
        setHasNew(true)
      }
    }
    prevCountRef.current = messages.length
    lastMessageIdRef.current = lastId
  }, [messages, atBottom])

  function jumpToBottom() {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
    setHasNew(false)
  }

  return (
    <div className="relative flex-1 min-h-0">
      <ScrollArea ref={scrollRef} className="h-full">
        <div className="mx-auto w-full max-w-3xl px-4 py-6 md:px-8">
          {isLoading ? (
            <LoadingShimmer />
          ) : messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <div className="h-12 w-12 rounded-full bg-bg-tertiary flex items-center justify-center ring-1 ring-border-subtle text-text-tertiary">
                <Info className="h-5 w-5" />
              </div>
              <p className="mt-3 text-[13px] font-medium text-text-primary">No messages yet</p>
              <p className="mt-1 max-w-xs text-[12px] text-text-secondary">
                Type below to send the first message in this conversation.
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-1">
              {messages.map((message, i) => {
                const prev = i > 0 ? messages[i - 1] : null
                const sameSender = prev && prev.role === message.role && !isSystemMessage(prev) && !isSystemMessage(message)

                if (isSystemMessage(message)) {
                  return (
                    <div
                      key={message.id}
                      className="my-2 flex justify-center animate-bubble-in"
                    >
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-bg-tertiary/60 px-2.5 py-1 text-[11px] text-text-tertiary ring-1 ring-border-subtle">
                        <Info className="h-3 w-3" />
                        {message.content}
                      </span>
                    </div>
                  )
                }

                const debugStyle = getDebugStyle(message)
                if (debugStyle) {
                  return (
                    <div key={message.id} className={cn('my-1 flex justify-center animate-bubble-in')}>
                      <div
                        className={cn(
                          'max-w-[85%] rounded-[8px] border px-3 py-2 text-[11.5px] font-mono leading-relaxed',
                          debugStyle,
                        )}
                      >
                        {message.content}
                      </div>
                    </div>
                  )
                }

                const isVisitor = message.role === 'visitor' || message.role === 'user'
                const agentId = message.metadata?.agent_id as string | undefined
                const agentName = agentId ? agentMap?.[agentId] ?? null : null

                const attachments = (message.metadata?.media as MediaAttachment[] | undefined) ?? []

                if (isVisitor) {
                  return (
                    <div
                      key={message.id}
                      className={cn(
                        'flex w-full items-end gap-2 group animate-bubble-in',
                        sameSender ? 'mt-0.5' : 'mt-3',
                      )}
                    >
                      {!sameSender ? (
                        <Avatar className="h-7 w-7 shrink-0">
                          <AvatarFallback className="bg-bg-tertiary text-text-secondary text-[10.5px] font-medium">
                            {(message.content.charAt(0) || '·').toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                      ) : (
                        <div className="h-7 w-7 shrink-0" aria-hidden />
                      )}
                      <div className="flex max-w-[85%] flex-col items-start md:max-w-[70%]">
                        <div className="rounded-[12px] bg-bg-secondary px-3.5 py-2 text-[13.5px] leading-relaxed text-text-primary ring-1 ring-border-subtle">
                          {message.content}
                          {attachments.length > 0 && (
                            <div className="mt-1.5 space-y-1">
                              {attachments.map((att, i) => (
                                <MediaBlock key={i} attachment={att} isVisitor={true} />
                              ))}
                            </div>
                          )}
                        </div>
                        <span className="mt-0.5 px-1 text-[10.5px] tabular-nums text-text-tertiary opacity-0 transition-opacity group-hover:opacity-100">
                          {formatTime(message.createdAt)}
                        </span>
                      </div>
                    </div>
                  )
                }

                // Bot/admin/assistant | right-aligned bubble
                return (
                  <div
                    key={message.id}
                    className={cn(
                      'flex w-full items-end justify-end gap-2 group animate-bubble-in',
                      sameSender ? 'mt-0.5' : 'mt-3',
                    )}
                  >
                    <div className="flex max-w-[85%] flex-col items-end md:max-w-[70%]">
                      <div className="rounded-[12px] bg-accent-muted px-3.5 py-2 text-[13.5px] leading-relaxed text-text-primary ring-1 ring-accent/20">
                        {message.content}
                        {attachments.length > 0 && (
                          <div className="mt-1.5 space-y-1">
                            {attachments.map((att, i) => (
                              <MediaBlock key={i} attachment={att} isVisitor={false} />
                            ))}
                          </div>
                        )}
                      </div>
                      <div className="mt-0.5 flex items-center gap-2 px-1 opacity-0 transition-opacity group-hover:opacity-100">
                        {agentName && (
                          <span className="text-[10.5px] text-text-tertiary">via {agentName}</span>
                        )}
                        <span className="text-[10.5px] tabular-nums text-text-tertiary">
                          {formatTime(message.createdAt)}
                        </span>
                      </div>
                    </div>
                    {!sameSender ? (
                      <Avatar className="h-7 w-7 shrink-0">
                        <AvatarFallback className="bg-accent text-white text-[10.5px] font-medium">
                          Op
                        </AvatarFallback>
                      </Avatar>
                    ) : (
                      <div className="h-7 w-7 shrink-0" aria-hidden />
                    )}
                  </div>
                )
              })}

              {(isTyping || isAgentThinking) && (
                <div className="flex w-full items-end gap-2 mt-3 animate-bubble-in">
                  <Avatar className="h-7 w-7 shrink-0">
                    <AvatarFallback className="bg-bg-tertiary text-text-secondary text-[10.5px] font-medium">
                      {isAgentThinking ? 'Op' : '·'}
                    </AvatarFallback>
                  </Avatar>
                  <div className="inline-flex items-center gap-1 rounded-[12px] bg-bg-secondary px-3.5 py-2.5 ring-1 ring-border-subtle">
                    <span className="typing-dot h-1.5 w-1.5 rounded-full bg-text-tertiary" />
                    <span className="typing-dot h-1.5 w-1.5 rounded-full bg-text-tertiary" />
                    <span className="typing-dot h-1.5 w-1.5 rounded-full bg-text-tertiary" />
                    {isAgentThinking && (
                      <span className="ml-1.5 text-[11px] text-text-tertiary">Agent thinking…</span>
                    )}
                  </div>
                </div>
              )}

              <div ref={endRef} className="h-2" />
            </div>
          )}
        </div>
      </ScrollArea>

      {/* "New messages" jump-to-bottom pill */}
      {hasNew && !atBottom && (
        <button
          type="button"
          onClick={jumpToBottom}
          className="absolute bottom-3 right-4 inline-flex items-center gap-1.5 rounded-full bg-accent px-3 py-1.5 text-[12px] font-medium text-white shadow-lg ring-1 ring-accent-hover hover:bg-accent-hover transition-all animate-fade-in"
        >
          <ChevronDown className="h-3.5 w-3.5" />
          New messages
        </button>
      )}
    </div>
  )
}

function LoadingShimmer() {
  return (
    <div className="space-y-4">
      {[60, 40, 75, 30, 55].map((w, i) => (
        <div key={i} className={cn('flex items-end gap-2', i % 2 === 0 ? '' : 'justify-end')}>
          {i % 2 === 0 && <div className="h-7 w-7 rounded-full shimmer" />}
          <div className="h-9 shimmer rounded-[12px]" style={{ width: `${w}%` }} />
          {i % 2 === 1 && <div className="h-7 w-7 rounded-full shimmer" />}
        </div>
      ))}
    </div>
  )
}
