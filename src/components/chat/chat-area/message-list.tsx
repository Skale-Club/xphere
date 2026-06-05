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

import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, Info, Loader2, Mail, RadioTower } from 'lucide-react'

import { ConversationMessage, MediaAttachment } from '@/types/chat'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { ChannelBadge, type Channel } from '@/components/design-system/channel-badge'
import { cn } from '@/lib/utils'
import { MediaBlock } from './media-block'

// Map a raw message/conversation channel to the design-system badge channel.
const MSG_BADGE_CHANNEL: Record<string, Channel> = {
  whatsapp: 'whatsapp', ghl_whatsapp: 'whatsapp', zernio_whatsapp: 'whatsapp',
  instagram: 'instagram', zernio_instagram: 'instagram',
  messenger: 'messenger', zernio_facebook: 'messenger',
  sms: 'sms', ghl_sms: 'sms',
  voice: 'voice', email: 'email', widget: 'web', web: 'web', manual: 'direct',
}

function toBadgeChannel(channel: string): Channel {
  return MSG_BADGE_CHANNEL[channel] ?? 'unknown'
}

/** Centered divider marking the start of a new channel group in the timeline. */
function ChannelDivider({ channel }: { channel: Channel }) {
  return (
    <div className="my-4 flex items-center gap-3 px-2 animate-bubble-in">
      <div className="h-px flex-1 bg-border-subtle" />
      <ChannelBadge channel={channel} size="sm" />
      <div className="h-px flex-1 bg-border-subtle" />
    </div>
  )
}

function startOfDayMs(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

/** "Hoje" / "Ontem" / "1 de junho" (+ ano se for outro ano). */
function formatDayLabel(iso: string): string {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  const today = startOfDayMs(new Date())
  const that = startOfDayMs(d)
  const dayMs = 86_400_000
  if (that === today) return 'Hoje'
  if (that === today - dayMs) return 'Ontem'
  return d.toLocaleDateString('pt-BR', {
    day: 'numeric',
    month: 'long',
    ...(d.getFullYear() !== new Date().getFullYear() ? { year: 'numeric' } : {}),
  })
}

/** Centered date pill marking the start of a new calendar day in the timeline. */
function DateDivider({ label }: { label: string }) {
  return (
    <div className="my-3 flex justify-center animate-bubble-in">
      <span className="rounded-full bg-bg-tertiary/70 px-3 py-1 text-[11px] font-medium capitalize text-text-secondary ring-1 ring-border-subtle backdrop-blur">
        {label}
      </span>
    </div>
  )
}

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
  /** When true, the empty center state explains that no outbound transport exists. */
  noAvailableChannel?: boolean
  /** First letter to show in visitor message avatars (contact name or phone). */
  visitorInitial?: string
  /** Pagination: callback to fetch older messages. */
  onLoadMore?: () => void
  /** Pagination: true when there are older messages available. */
  hasMore?: boolean
  /** Pagination: true while older messages are being fetched. */
  isLoadingMore?: boolean
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
  primaryChannel,
  noAvailableChannel = false,
  visitorInitial = '?',
  onLoadMore,
  hasMore = false,
  isLoadingMore = false,
}: MessageListProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const endRef = useRef<HTMLDivElement>(null)
  const [hasNew, setHasNew] = useState(false)
  const [atBottom, setAtBottom] = useState(true)
  const atBottomRef = useRef(true)
  const initialBottomStickRef = useRef(false)
  const initialBottomStickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const autoScrollingRef = useRef(false)
  const lastMessageIdRef = useRef<string | null>(null)
  const firstMessageIdRef = useRef<string | null>(null)
  const prevCountRef = useRef(0)
  const prevScrollHeightRef = useRef(0)

  const getViewport = useCallback((): HTMLElement | null => {
    return (scrollRef.current?.querySelector('[data-radix-scroll-area-viewport]') as HTMLElement | null) ?? null
  }, [])

  const stopInitialBottomStick = useCallback(() => {
    initialBottomStickRef.current = false
    if (initialBottomStickTimerRef.current) {
      clearTimeout(initialBottomStickTimerRef.current)
      initialBottomStickTimerRef.current = null
    }
  }, [])

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'instant') => {
    const viewport = getViewport()
    if (!viewport) {
      endRef.current?.scrollIntoView({ behavior, block: 'end' })
      return
    }

    autoScrollingRef.current = true
    if (behavior === 'smooth') {
      endRef.current?.scrollIntoView({ behavior, block: 'end' })
    } else {
      viewport.scrollTop = viewport.scrollHeight
    }
    requestAnimationFrame(() => {
      autoScrollingRef.current = false
    })
  }, [getViewport])

  const startInitialBottomStick = useCallback(() => {
    stopInitialBottomStick()
    initialBottomStickRef.current = true
    initialBottomStickTimerRef.current = setTimeout(() => {
      initialBottomStickRef.current = false
      initialBottomStickTimerRef.current = null
    }, 1600)
  }, [stopInitialBottomStick])

  // After the initial fetch completes (isLoading false → messages rendered),
  // re-apply scroll-to-bottom via RAF so images that loaded after the
  // synchronous useLayoutEffect also get accounted for.
  useEffect(() => {
    if (isLoading || messages.length === 0) return
    let second: number | null = null
    const id = requestAnimationFrame(() => {
      scrollToBottom('instant')
      second = requestAnimationFrame(() => scrollToBottom('instant'))
    })
    return () => {
      cancelAnimationFrame(id)
      if (second !== null) cancelAnimationFrame(second)
    }
  }, [isLoading, messages.length, scrollToBottom])

  useEffect(() => {
    return () => stopInitialBottomStick()
  }, [stopInitialBottomStick])

  useEffect(() => {
    const content = contentRef.current
    if (!content || typeof ResizeObserver === 'undefined') return

    const observer = new ResizeObserver(() => {
      if (initialBottomStickRef.current || atBottomRef.current) {
        scrollToBottom('instant')
      }
    })
    observer.observe(content)
    return () => observer.disconnect()
  }, [scrollToBottom])

  // Track "is the user near the bottom?" via scroll position on the viewport.
  useEffect(() => {
    const viewport = scrollRef.current?.querySelector(
      '[data-radix-scroll-area-viewport]',
    ) as HTMLElement | null
    if (!viewport) return
    const onScroll = () => {
      const dist = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight
      const isNear = dist < 80
      atBottomRef.current = isNear
      setAtBottom(isNear)
      if (isNear) setHasNew(false)
    }
    viewport.addEventListener('scroll', onScroll, { passive: true })
    onScroll()
    return () => viewport.removeEventListener('scroll', onScroll)
  }, [])

  useEffect(() => {
    const viewport = getViewport()
    if (!viewport) return
    const cancelInitialStick = () => {
      if (!autoScrollingRef.current) stopInitialBottomStick()
    }
    viewport.addEventListener('wheel', cancelInitialStick, { passive: true })
    viewport.addEventListener('touchstart', cancelInitialStick, { passive: true })
    viewport.addEventListener('pointerdown', cancelInitialStick, { passive: true })
    return () => {
      viewport.removeEventListener('wheel', cancelInitialStick)
      viewport.removeEventListener('touchstart', cancelInitialStick)
      viewport.removeEventListener('pointerdown', cancelInitialStick)
    }
  }, [getViewport, stopInitialBottomStick])

  // Auto-scroll / scroll-restoration when messages array changes.
  useLayoutEffect(() => {
    const grew = messages.length > prevCountRef.current
    const firstId = messages[0]?.id ?? null
    const lastId = messages[messages.length - 1]?.id ?? null

    if (grew) {
      const isPrepend = firstId !== firstMessageIdRef.current && firstMessageIdRef.current !== null
      const isInitialLoad = prevCountRef.current === 0

      if (isPrepend) {
        // Older messages were prepended — restore scroll position so the
        // previously-visible content stays in view.
        const viewport = getViewport()
        if (viewport && prevScrollHeightRef.current > 0) {
          viewport.scrollTop += viewport.scrollHeight - prevScrollHeightRef.current
          prevScrollHeightRef.current = 0
        }
      } else if (isInitialLoad) {
        // Keep the latest message anchored while late media/layout height settles.
        startInitialBottomStick()
        scrollToBottom('instant')
      } else if (lastId !== lastMessageIdRef.current) {
        // New message appended at the end
        if (atBottom) {
          scrollToBottom('smooth')
        } else {
          requestAnimationFrame(() => setHasNew(true))
        }
      }
    }

    prevCountRef.current = messages.length
    firstMessageIdRef.current = firstId
    lastMessageIdRef.current = lastId
  }, [messages, atBottom, getViewport, scrollToBottom, startInitialBottomStick])

  function jumpToBottom() {
    scrollToBottom('smooth')
    setHasNew(false)
  }

  // Multichannel: precompute which messages start a new channel group so the
  // timeline can render a divider when the channel changes (e.g. SMS → Email).
  // System/debug rows don't carry a channel and never trigger a divider.
  const channelDividers: (Channel | null)[] = useMemo(() => {
    const out: (Channel | null)[] = []
    let last: string | null = null
    let seenFirst = false
    for (const m of messages) {
      const ch =
        isSystemMessage(m) || getDebugStyle(m)
          ? null
          : ((m.channel as string | null) ?? primaryChannel ?? null)
      if (ch == null) {
        out.push(null)
        continue
      }
      if (!seenFirst) {
        seenFirst = true
        last = ch
        out.push(null)
      } else if (ch !== last) {
        last = ch
        out.push(toBadgeChannel(ch))
      } else {
        out.push(null)
      }
    }
    return out
  }, [messages, primaryChannel])

  // Day separators: label the first message and every message that starts a new
  // calendar day, so long threads stay readable across days.
  const dayDividers: (string | null)[] = useMemo(() => {
    const out: (string | null)[] = []
    let lastDay: number | null = null
    for (const m of messages) {
      const t = new Date(m.createdAt).getTime()
      if (isNaN(t)) {
        out.push(null)
        continue
      }
      const day = startOfDayMs(new Date(t))
      if (lastDay === null || day !== lastDay) {
        out.push(formatDayLabel(m.createdAt))
        lastDay = day
      } else {
        out.push(null)
      }
    }
    return out
  }, [messages])

  return (
    <div className="relative flex-1 min-h-0">
      <ScrollArea ref={scrollRef} className="h-full">
        <div ref={contentRef} className="mx-auto w-full max-w-3xl px-4 py-10 md:px-8">
          {(hasMore || isLoadingMore) && !isLoading && (
            <div className="flex justify-center pb-4 pt-2">
              {isLoadingMore ? (
                <Loader2 className="h-4 w-4 animate-spin text-text-tertiary" />
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    prevScrollHeightRef.current = getViewport()?.scrollHeight ?? 0
                    onLoadMore?.()
                  }}
                  className="text-[12px] text-text-secondary hover:text-text-primary transition-colors underline-offset-2 hover:underline"
                >
                  Carregar mensagens anteriores
                </button>
              )}
            </div>
          )}
          {isLoading ? (
            <LoadingShimmer />
          ) : messages.length === 0 && noAvailableChannel ? (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-amber-500/10 text-amber-300 ring-1 ring-amber-500/25">
                <RadioTower className="h-5 w-5" />
              </div>
              <p className="mt-3 text-[13px] font-medium text-text-primary">
                No active channel for this contact
              </p>
              <p className="mt-1 max-w-sm text-[12px] leading-relaxed text-text-secondary">
                Activate SMS, WhatsApp, or Email before starting this conversation.
              </p>
            </div>
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
                const sameSender = prev
                  && prev.role === message.role
                  && !isSystemMessage(prev)
                  && !isSystemMessage(message)
                  && !dayDividers[i]
                  && !channelDividers[i]
                const dateDivider = dayDividers[i] ? <DateDivider label={dayDividers[i]!} /> : null

                if (isSystemMessage(message)) {
                  return (
                    <Fragment key={message.id}>
                      {dateDivider}
                      <div className="my-2 flex justify-center animate-bubble-in">
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-bg-tertiary/60 px-2.5 py-1 text-[11px] text-text-tertiary ring-1 ring-border-subtle">
                          <Info className="h-3 w-3" />
                          {message.content}
                        </span>
                      </div>
                    </Fragment>
                  )
                }

                const debugStyle = getDebugStyle(message)
                if (debugStyle) {
                  return (
                    <Fragment key={message.id}>
                      {dateDivider}
                      <div className={cn('my-1 flex justify-center animate-bubble-in')}>
                        <div
                          className={cn(
                            'max-w-[85%] rounded-[8px] border px-3 py-2 text-[11.5px] font-mono leading-relaxed',
                            debugStyle,
                          )}
                        >
                          {message.content}
                        </div>
                      </div>
                    </Fragment>
                  )
                }

                const isVisitor = message.role === 'visitor' || message.role === 'user'
                const agentId = message.metadata?.agent_id as string | undefined
                const agentName = agentId ? agentMap?.[agentId] ?? null : null

                const attachments = (message.metadata?.media as MediaAttachment[] | undefined) ?? []

                if (isVisitor) {
                  return (
                    <Fragment key={message.id}>
                      {dateDivider}
                      {channelDividers[i] && <ChannelDivider channel={channelDividers[i]!} />}
                      <div
                        className={cn('w-full group animate-bubble-in', sameSender ? 'mt-0.5' : 'mt-3')}
                      >
                      {/* avatar + bubble — centered */}
                      <div className="flex items-center gap-2">
                        <Avatar className="h-7 w-7 shrink-0">
                          <AvatarFallback className="bg-bg-tertiary text-text-secondary text-[10.5px] font-medium">
                            {(message.content?.charAt(0) || visitorInitial).toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                        <div className="max-w-[85%] md:max-w-[70%] rounded-[12px] bg-bg-secondary px-3.5 py-2 text-[13.5px] leading-relaxed text-text-primary ring-1 ring-border-subtle whitespace-pre-wrap break-words">
                          {message.channel === 'email' && message.email_subject && (
                            <div className="mb-1.5 flex items-center gap-1.5 text-[11.5px] font-medium text-text-secondary border-b border-border-subtle pb-1.5">
                              <Mail className="h-3 w-3 shrink-0" />
                              <span className="truncate">{message.email_subject}</span>
                            </div>
                          )}
                          {message.content}
                          {attachments.length > 0 && (
                            <div className="mt-1.5 space-y-1">
                              {attachments.map((att, i) => (
                                <MediaBlock key={i} attachment={att} isVisitor={true} />
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                      {/* timestamp — outside alignment row */}
                      <span className="mt-0.5 pl-9 block text-[10.5px] tabular-nums text-text-tertiary opacity-0 transition-opacity group-hover:opacity-100">
                        {formatTime(message.createdAt)}
                      </span>
                      </div>
                    </Fragment>
                  )
                }

                // Bot/admin/assistant | right-aligned bubble
                return (
                  <Fragment key={message.id}>
                    {dateDivider}
                    {channelDividers[i] && <ChannelDivider channel={channelDividers[i]!} />}
                    <div
                      className={cn('w-full group animate-bubble-in', sameSender ? 'mt-0.5' : 'mt-3')}
                    >
                    {/* bubble + avatar — centered */}
                    <div className="flex items-center justify-end gap-2">
                      <div className="max-w-[85%] md:max-w-[70%] rounded-[12px] bg-accent-muted px-3.5 py-2 text-[13.5px] leading-relaxed text-text-primary ring-1 ring-accent/20 whitespace-pre-wrap break-words">
                        {message.channel === 'email' && message.email_subject && (
                          <div className="mb-1.5 flex items-center gap-1.5 text-[11.5px] font-medium text-text-secondary border-b border-border-subtle pb-1.5">
                            <Mail className="h-3 w-3 shrink-0" />
                            <span className="truncate">{message.email_subject}</span>
                          </div>
                        )}
                        {message.content}
                        {attachments.length > 0 && (
                          <div className="mt-1.5 space-y-1">
                            {attachments.map((att, i) => (
                              <MediaBlock key={i} attachment={att} isVisitor={false} />
                            ))}
                          </div>
                        )}
                      </div>
                      <Avatar className="h-7 w-7 shrink-0">
                        <AvatarFallback className="bg-accent text-white text-[10.5px] font-medium">
                          Op
                        </AvatarFallback>
                      </Avatar>
                    </div>
                    {/* timestamp — outside alignment row */}
                    <div className="mt-0.5 pr-9 flex items-center justify-end gap-2 opacity-0 transition-opacity group-hover:opacity-100">
                      {agentName && (
                        <span className="text-[10.5px] text-text-tertiary">via {agentName}</span>
                      )}
                      <span className="text-[10.5px] tabular-nums text-text-tertiary">
                        {formatTime(message.createdAt)}
                      </span>
                    </div>
                  </div>
                  </Fragment>
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
