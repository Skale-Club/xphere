'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Send, RotateCcw, Bot, User, Wrench, Clock } from 'lucide-react'

type AgentChannel =
  | 'web_widget'
  | 'whatsapp'
  | 'sms'
  | 'messenger'
  | 'instagram'
  | 'manychat'
  | 'telegram'

const CHANNEL_LABELS: Record<AgentChannel, string> = {
  web_widget: 'Web Widget',
  whatsapp: 'WhatsApp',
  sms: 'SMS',
  messenger: 'Messenger',
  instagram: 'Instagram',
  manychat: 'ManyChat',
  telegram: 'Telegram',
}

type ToolCallDetail = {
  name: string
  args: Record<string, unknown>
  result: string
  denied: boolean
  denied_reason?: string
  tool_call_index?: number
}

type PlaygroundMessage = {
  id: string
  role: 'user' | 'assistant' | 'tool_call' | 'partner_badge'
  content: string
  streaming?: boolean
  toolName?: string // for role='tool_call' — live badge during streaming
  toolDetails?: ToolCallDetail[] // populated after streaming from invocation details
  partnerName?: string // for role='partner_badge'
  partnerDone?: boolean // true once partner_done received
}

type InvocationDetail = {
  id: string
  tool_calls: ToolCallDetail[] | null
  duration_ms: number | null
  tokens_in: number | null
  tokens_out: number | null
  cost_usd: number | null
  status: string
}

interface AgentPlaygroundProps {
  agentId: string
  agentName: string
}

export function AgentPlayground({ agentId, agentName }: AgentPlaygroundProps) {
  const [messages, setMessages] = useState<PlaygroundMessage[]>([])
  const [channel, setChannel] = useState<AgentChannel>('web_widget')
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [historyWindow, setHistoryWindow] = useState<
    Array<{ role: 'user' | 'assistant'; content: string }>
  >([])
  const [input, setInput] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const [lastInvocationDetails, setLastInvocationDetails] =
    useState<InvocationDetail | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Fetch invocation details after streaming completes (for tool-call args/result/timing)
  const fetchInvocationDetails = useCallback(
    async (invId: string): Promise<void> => {
      try {
        const res = await fetch(`/api/playground/${agentId}/invocation/${invId}`)
        if (!res.ok) return
        const detail = (await res.json()) as InvocationDetail
        setLastInvocationDetails(detail)

        // Update tool_call messages with detailed args + result
        if (detail.tool_calls && detail.tool_calls.length > 0) {
          setMessages((prev) =>
            prev.map((m) => {
              if (m.role === 'tool_call' && m.toolName) {
                const match = detail.tool_calls?.find((tc) => tc.name === m.toolName)
                if (match) {
                  return { ...m, toolDetails: [match] }
                }
              }
              return m
            })
          )
        }
      } catch {
        // Non-fatal — tool details are cosmetic
      }
    },
    [agentId]
  )

  const sendMessage = useCallback(async (): Promise<void> => {
    const content = input.trim()
    if (!content || isStreaming) return

    setInput('')
    setIsStreaming(true)
    setLastInvocationDetails(null)

    const userMsgId = crypto.randomUUID()
    setMessages((prev) => [...prev, { id: userMsgId, role: 'user', content }])

    const assistantMsgId = crypto.randomUUID()
    setMessages((prev) => [
      ...prev,
      { id: assistantMsgId, role: 'assistant', content: '', streaming: true },
    ])

    const currentHistory = [...historyWindow]
    let accumulated = ''
    let capturedInvocationId = ''

    try {
      const res = await fetch(`/api/playground/${agentId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: content,
          channel,
          sessionId: sessionId ?? undefined,
          historyWindow: currentHistory,
        }),
      })

      if (!res.ok || !res.body) {
        const errorText = await res.text().catch(() => 'Request failed')
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMsgId
              ? { ...m, content: `Error: ${errorText}`, streaming: false }
              : m
          )
        )
        return
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })

        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed) continue
          try {
            const event = JSON.parse(trimmed) as Record<string, unknown>

            if (event.event === 'session' && typeof event.sessionId === 'string') {
              setSessionId(event.sessionId)
            } else if (
              event.event === 'invocation_id' &&
              typeof event.invocationId === 'string'
            ) {
              capturedInvocationId = event.invocationId
            } else if (event.event === 'token' && typeof event.text === 'string') {
              accumulated += event.text
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantMsgId ? { ...m, content: accumulated } : m
                )
              )
            } else if (event.event === 'tool_call' && typeof event.name === 'string') {
              const toolMsgId = crypto.randomUUID()
              setMessages((prev) => [
                ...prev,
                {
                  id: toolMsgId,
                  role: 'tool_call' as const,
                  content: `Calling ${event.name as string}…`,
                  toolName: event.name as string,
                },
              ])
            } else if (
              event.event === 'partner_start' &&
              typeof event.partnerName === 'string'
            ) {
              const badgeId = crypto.randomUUID()
              setMessages((prev) => [
                ...prev,
                {
                  id: badgeId,
                  role: 'partner_badge' as const,
                  content: `Asking ${event.partnerName as string}…`,
                  partnerName: event.partnerName as string,
                  partnerDone: false,
                },
              ])
            } else if (
              event.event === 'partner_done' &&
              typeof event.partnerName === 'string'
            ) {
              setMessages((prev) =>
                prev.map((m) =>
                  m.role === 'partner_badge' &&
                  m.partnerName === event.partnerName &&
                  !m.partnerDone
                    ? { ...m, content: `${event.partnerName as string} responded`, partnerDone: true }
                    : m
                )
              )
            }
          } catch {
            // Ignore malformed lines
          }
        }
      }

      // Finalize streaming
      setMessages((prev) =>
        prev.map((m) => (m.id === assistantMsgId ? { ...m, streaming: false } : m))
      )

      // Update history window for next turn
      setHistoryWindow((prev) => [
        ...prev,
        { role: 'user', content },
        { role: 'assistant', content: accumulated },
      ])

      // Fetch invocation details for tool-call args/results/timing
      if (capturedInvocationId) {
        // Small delay to let the DB write complete via after()
        setTimeout(() => {
          void fetchInvocationDetails(capturedInvocationId)
        }, 600)
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantMsgId
            ? { ...m, content: `Error: ${msg}`, streaming: false }
            : m
        )
      )
    } finally {
      setIsStreaming(false)
      textareaRef.current?.focus()
    }
  }, [input, isStreaming, historyWindow, agentId, channel, sessionId, fetchInvocationDetails])

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>): void {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void sendMessage()
    }
  }

  function resetSession(): void {
    setSessionId(null)
    setMessages([])
    setHistoryWindow([])
    setInput('')
    setLastInvocationDetails(null)
    textareaRef.current?.focus()
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b bg-background shrink-0">
        <div className="flex items-center gap-3">
          <Avatar className="h-8 w-8">
            <AvatarFallback className="bg-primary/10 text-primary text-xs">
              <Bot className="h-4 w-4" />
            </AvatarFallback>
          </Avatar>
          <div>
            <p className="text-sm font-medium">{agentName}</p>
            <p className="text-xs text-muted-foreground">
              Playground ·{' '}
              <code className="bg-muted px-1 rounded text-[10px]">mode=playground</code>
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* Channel selector — PLAY-02 */}
          <Select
            value={channel}
            onValueChange={(v) => setChannel(v as AgentChannel)}
            disabled={isStreaming}
          >
            <SelectTrigger className="h-8 w-36 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.entries(CHANNEL_LABELS) as [AgentChannel, string][]).map(
                ([value, label]) => (
                  <SelectItem key={value} value={value} className="text-xs">
                    {label}
                  </SelectItem>
                )
              )}
            </SelectContent>
          </Select>

          {sessionId && (
            <Badge variant="outline" className="text-xs font-mono hidden sm:flex">
              {sessionId.slice(0, 8)}…
            </Badge>
          )}

          {/* New session — PLAY-03 */}
          <Button
            variant="outline"
            size="sm"
            onClick={resetSession}
            disabled={isStreaming}
          >
            <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
            New session
          </Button>
        </div>
      </div>

      {/* Messages */}
      <ScrollArea className="flex-1 px-4 bg-neutral-50/50 dark:bg-neutral-900/20">
        <div className="py-4 space-y-4 max-w-2xl mx-auto">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 text-center text-muted-foreground">
              <Bot className="h-10 w-10 mb-3 opacity-30" />
              <p className="text-sm font-medium">Start a conversation</p>
              <p className="text-xs mt-1">
                Responses are not saved · tagged{' '}
                <code className="bg-muted px-1 rounded text-[10px]">mode=playground</code> ·
                excluded from production metrics
              </p>
            </div>
          )}

          {messages.map((msg) => {
            // Partner delegation badge (DELEG-08 style)
            if (msg.role === 'partner_badge') {
              return (
                <div key={msg.id} className="flex justify-center my-2">
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-violet-50 text-violet-700 border border-violet-200 dark:bg-violet-950/30 dark:text-violet-300 dark:border-violet-800/50">
                    <svg
                      className={`w-3 h-3 ${!msg.partnerDone ? 'animate-pulse' : ''}`}
                      fill="currentColor"
                      viewBox="0 0 8 8"
                    >
                      <circle cx="4" cy="4" r="3" />
                    </svg>
                    {msg.content}
                  </span>
                </div>
              )
            }

            // Tool call inline — PLAY-01
            if (msg.role === 'tool_call') {
              const detail = msg.toolDetails?.[0]
              return (
                <div key={msg.id} className="flex justify-center my-1">
                  <div className="rounded-xl border px-4 py-2 text-[11px] font-mono bg-blue-50/80 border-blue-200/50 text-blue-700 dark:bg-blue-950/30 dark:border-blue-800/50 dark:text-blue-300 max-w-[85%] w-full">
                    <div className="flex items-center gap-2 mb-1">
                      <Wrench className="h-3 w-3 shrink-0" />
                      <span className="font-semibold">{msg.toolName}</span>
                      {detail?.denied && (
                        <Badge variant="destructive" className="text-[10px] h-4">
                          denied
                        </Badge>
                      )}
                    </div>
                    {detail ? (
                      <div className="space-y-1 text-[10px] text-blue-600 dark:text-blue-400">
                        <div>
                          <span className="opacity-60">args: </span>
                          <span>{JSON.stringify(detail.args)}</span>
                        </div>
                        <div>
                          <span className="opacity-60">result: </span>
                          <span>{detail.result}</span>
                        </div>
                      </div>
                    ) : (
                      <div className="text-[10px] text-blue-500 animate-pulse">running…</div>
                    )}
                  </div>
                </div>
              )
            }

            // User message
            if (msg.role === 'user') {
              return (
                <div key={msg.id} className="flex gap-3 flex-row-reverse">
                  <div className="shrink-0 mt-0.5">
                    <Avatar className="h-7 w-7">
                      <AvatarFallback className="bg-secondary">
                        <User className="h-3.5 w-3.5" />
                      </AvatarFallback>
                    </Avatar>
                  </div>
                  <div className="max-w-[75%] rounded-2xl rounded-tr-sm px-3.5 py-2.5 text-sm bg-primary text-primary-foreground">
                    {msg.content}
                  </div>
                </div>
              )
            }

            // Assistant message
            return (
              <div key={msg.id} className="flex gap-3 flex-row">
                <div className="shrink-0 mt-0.5">
                  <Avatar className="h-7 w-7">
                    <AvatarFallback className="bg-primary/10 text-primary">
                      <Bot className="h-3.5 w-3.5" />
                    </AvatarFallback>
                  </Avatar>
                </div>
                <div className="max-w-[75%] rounded-2xl rounded-tl-sm px-3.5 py-2.5 text-sm bg-muted">
                  {msg.content ||
                    (msg.streaming ? (
                      <span className="inline-flex gap-0.5 items-center">
                        <span className="w-1.5 h-1.5 rounded-full bg-current animate-bounce [animation-delay:0ms]" />
                        <span className="w-1.5 h-1.5 rounded-full bg-current animate-bounce [animation-delay:150ms]" />
                        <span className="w-1.5 h-1.5 rounded-full bg-current animate-bounce [animation-delay:300ms]" />
                      </span>
                    ) : (
                      ''
                    ))}
                  {msg.streaming && msg.content && (
                    <span className="inline-block w-0.5 h-3.5 bg-current ml-0.5 animate-pulse align-middle" />
                  )}
                </div>
              </div>
            )
          })}
          <div ref={bottomRef} />
        </div>
      </ScrollArea>

      {/* Stats bar — shows after each completed turn */}
      {lastInvocationDetails && (
        <div className="px-4 py-1.5 border-t bg-muted/30 flex items-center gap-4 text-[11px] text-muted-foreground font-mono">
          {lastInvocationDetails.duration_ms != null && (
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {lastInvocationDetails.duration_ms}ms
            </span>
          )}
          {lastInvocationDetails.tokens_in != null && (
            <span>in: {lastInvocationDetails.tokens_in}</span>
          )}
          {lastInvocationDetails.tokens_out != null && (
            <span>out: {lastInvocationDetails.tokens_out}</span>
          )}
          {lastInvocationDetails.cost_usd != null && (
            <span>${Number(lastInvocationDetails.cost_usd).toFixed(5)}</span>
          )}
          <span className="ml-auto text-violet-600 dark:text-violet-400 font-medium">
            mode=playground
          </span>
        </div>
      )}

      {/* Input */}
      <div className="px-4 py-3 border-t bg-background shrink-0">
        <div className="max-w-2xl mx-auto flex gap-2 items-end">
          <Textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a message… (Enter to send, Shift+Enter for newline)"
            className="resize-none min-h-[44px] max-h-[140px] text-sm"
            rows={1}
            disabled={isStreaming}
          />
          <Button
            size="icon"
            onClick={() => void sendMessage()}
            disabled={!input.trim() || isStreaming}
            className="shrink-0 h-[44px] w-[44px]"
          >
            <Send className="h-4 w-4" />
          </Button>
        </div>
        <p className="text-center text-xs text-muted-foreground mt-2">
          Playground · responses not saved · channel: {CHANNEL_LABELS[channel]}
        </p>
      </div>
    </div>
  )
}
