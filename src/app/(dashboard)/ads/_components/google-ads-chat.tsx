'use client'

import React, { useState, useRef, useEffect, useCallback } from 'react'
import { Send, Loader2, ArrowLeft, CheckCircle2, XCircle, AlertTriangle } from 'lucide-react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

type Message = { id: string; role: 'user' | 'assistant'; content: string }

type PendingTool = {
  tool_use_id: string
  tool_name: string
  input: Record<string, unknown>
  // Full Claude response.content blocks — needed to reconstruct the proper
  // tool_use turn when the user approves (Anthropic API requirement).
  assistant_content?: unknown[]
}

const TOOL_LABELS: Record<string, string> = {
  pause_campaign: 'Pause Campaign',
  enable_campaign: 'Enable Campaign',
  set_daily_budget: 'Update Daily Budget',
}

const TOOL_DESCRIPTIONS: Record<string, (input: Record<string, unknown>) => string> = {
  pause_campaign: (i) => `Pause campaign "${i.campaign_name ?? i.campaign_id}"`,
  enable_campaign: (i) => `Enable campaign "${i.campaign_name ?? i.campaign_id}"`,
  set_daily_budget: (i) => `Set daily budget to $${i.daily_budget_usd} for "${i.campaign_name ?? i.campaign_id}"`,
}

function uid() { return Math.random().toString(36).slice(2) }

async function streamChat(
  url: string,
  payload: unknown,
  onText: (text: string) => void,
  onToolApprovalRequired: (tool: PendingTool) => void,
  onError: (msg: string) => void,
) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!res.ok || !res.body) throw new Error('Failed to connect to AI')

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let currentEvent = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''

    for (const line of lines) {
      if (line.startsWith('event: ')) {
        currentEvent = line.slice(7).trim()
        continue
      }
      if (!line.startsWith('data: ')) continue

      const raw = line.slice(6).trim()
      if (!raw || raw === '{}') continue

      try {
        const parsed = JSON.parse(raw) as Record<string, unknown>

        if (currentEvent === 'error' || 'error' in parsed) {
          onError((parsed.error as string | undefined) ?? 'Unknown error')
          continue
        }
        if (currentEvent === 'text' || 'text' in parsed) {
          onText(parsed.text as string)
          continue
        }
        if (currentEvent === 'tool_approval_required' || ('tool_use_id' in parsed && 'tool_name' in parsed)) {
          onToolApprovalRequired(parsed as PendingTool)
          continue
        }
      } catch { /* skip malformed lines */ }
    }
  }
}

export function GoogleAdsAiChat({
  customerId,
  customerName,
  connections,
  accountSnapshot,
}: {
  customerId: string
  customerName: string
  connections: { id: string; name: string }[]
  accountSnapshot?: string
}) {
  const [messages, setMessages] = useState<Message[]>([{
    id: uid(),
    role: 'assistant',
    content: `Hi! I'm your Google Ads AI assistant. I can analyze your campaigns, show insights, and help you manage your ads.\n\nConnected account: **${customerName}**\n\nTry: "Show me campaign performance for the last 30 days" or "Which campaign has the highest cost per conversion?"`,
  }])
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [pendingTool, setPendingTool] = useState<PendingTool | null>(null)
  const [activeCustomerId, setActiveCustomerId] = useState(customerId)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages, pendingTool])

  const sendMessage = useCallback(async (userText: string) => {
    if (streaming) return

    const userMsg: Message = { id: uid(), role: 'user', content: userText }
    const assistantId = uid()
    setMessages((prev) => [...prev, userMsg, { id: assistantId, role: 'assistant', content: '' }])
    setStreaming(true)
    setPendingTool(null)

    const history = [...messages, userMsg].map((m) => ({ role: m.role, content: m.content }))
    let assistantText = ''

    try {
      await streamChat(
        '/api/ads/google/chat',
        { messages: history, customer_id: activeCustomerId, account_snapshot: accountSnapshot || undefined },
        (text) => {
          assistantText += text
          setMessages((prev) => prev.map((m) => m.id === assistantId ? { ...m, content: m.content + text } : m))
        },
        (tool) => setPendingTool(tool),
        (errMsg) => setMessages((prev) => prev.map((m) => m.id === assistantId ? { ...m, content: `Error: ${errMsg}` } : m)),
      )
      if (assistantText.length > 80) {
        void fetch('/api/ads/memories/extract', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messages: [...history, { role: 'assistant', content: assistantText }],
            platform: 'google',
          }),
        }).catch(() => {})
      }
    } catch (e) {
      setMessages((prev) => prev.map((m) =>
        m.id === assistantId ? { ...m, content: e instanceof Error ? `Error: ${e.message}` : 'An error occurred.' } : m,
      ))
    } finally {
      setStreaming(false)
    }
  }, [messages, streaming, activeCustomerId])

  // Separate approval submission: does NOT add a new user message.
  // The server reconstructs the conversation from assistant_content (tool_use) +
  // tool_result internally.
  const submitApproval = useCallback(async (tool: PendingTool) => {
    if (streaming) return

    const assistantId = uid()
    setMessages((prev) => [...prev, { id: assistantId, role: 'assistant', content: '' }])
    setStreaming(true)
    setPendingTool(null)

    const currentMessages = messages
    const trailingAssistant = currentMessages.at(-1)
    const historyForServer = (trailingAssistant?.role === 'assistant' && !trailingAssistant.content.trim()
      ? currentMessages.slice(0, -1)
      : currentMessages
    ).map((m) => ({ role: m.role, content: m.content }))

    try {
      await streamChat(
        '/api/ads/google/chat',
        { messages: historyForServer, customer_id: activeCustomerId, approved_tool: tool, account_snapshot: accountSnapshot || undefined },
        (text) => setMessages((prev) => prev.map((m) => m.id === assistantId ? { ...m, content: m.content + text } : m)),
        (newTool) => setPendingTool(newTool),
        (errMsg) => setMessages((prev) => prev.map((m) => m.id === assistantId ? { ...m, content: `Error: ${errMsg}` } : m)),
      )
    } catch (e) {
      setMessages((prev) => prev.map((m) =>
        m.id === assistantId ? { ...m, content: e instanceof Error ? `Error: ${e.message}` : 'An error occurred.' } : m,
      ))
    } finally {
      setStreaming(false)
    }
  }, [messages, streaming, activeCustomerId])

  function handleDeny() {
    setPendingTool(null)
    setMessages((prev) => [...prev, { id: uid(), role: 'assistant', content: 'OK, I cancelled that action. Let me know if you need anything else.' }])
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const text = input.trim()
    if (!text || streaming) return
    setInput('')
    void sendMessage(text)
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-border-subtle px-6 py-3 shrink-0">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" asChild>
            <Link href="/ads/google"><ArrowLeft className="h-3.5 w-3.5 mr-1.5" />Overview</Link>
          </Button>
          <span className="text-[13px] font-medium text-text-primary">AI Ads Assistant</span>
          <span className="rounded-full bg-[#4285F4]/10 px-2 py-0.5 text-[10.5px] font-medium text-[#4285F4]">Google Ads</span>
        </div>
        {connections.length > 1 && (
          <select value={activeCustomerId} onChange={(e) => setActiveCustomerId(e.target.value)}
            className="rounded-lg border border-border-subtle bg-bg-secondary px-3 py-1.5 text-[12.5px] text-text-primary focus:outline-none">
            {connections.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
        {messages.map((m) => (
          <div key={m.id} className={cn('flex gap-3', m.role === 'user' ? 'justify-end' : 'justify-start')}>
            {m.role === 'assistant' && (
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#4285F4]/10 text-[11px] font-bold text-[#4285F4]">AI</div>
            )}
            <div className={cn('max-w-[75%] rounded-2xl px-4 py-2.5 text-[13.5px] leading-relaxed whitespace-pre-wrap',
              m.role === 'user' ? 'bg-accent text-white rounded-br-sm' : 'bg-bg-secondary text-text-primary rounded-bl-sm border border-border-subtle')}>
              {m.content || (streaming && m.role === 'assistant' && (
                <span className="inline-flex gap-1">
                  {[0, 150, 300].map((d) => (
                    <span key={d} className="h-1.5 w-1.5 rounded-full bg-text-tertiary animate-bounce" style={{ animationDelay: `${d}ms` }} />
                  ))}
                </span>
              ))}
            </div>
          </div>
        ))}

        {pendingTool && (
          <div className="flex justify-start gap-3">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-amber-500/10 text-[11px] font-bold text-amber-400">AI</div>
            <div className="max-w-[75%] rounded-2xl rounded-bl-sm border border-amber-500/30 bg-amber-500/5 px-4 py-3 space-y-3">
              <div className="flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
                <div>
                  <p className="text-[13px] font-medium text-text-primary">Action requires approval</p>
                  <p className="text-[12px] text-text-secondary mt-0.5">
                    {TOOL_DESCRIPTIONS[pendingTool.tool_name]?.(pendingTool.input) ?? TOOL_LABELS[pendingTool.tool_name]}
                  </p>
                </div>
              </div>
              <div className="flex gap-2">
                <Button size="sm" onClick={() => void submitApproval(pendingTool)} className="h-7 gap-1.5">
                  <CheckCircle2 className="h-3.5 w-3.5" />Approve
                </Button>
                <Button size="sm" variant="outline" onClick={handleDeny} className="h-7 gap-1.5">
                  <XCircle className="h-3.5 w-3.5" />Cancel
                </Button>
              </div>
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      <div className="border-t border-border-subtle p-4 shrink-0">
        <form onSubmit={handleSubmit} className="flex items-end gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e: React.KeyboardEvent<HTMLTextAreaElement>) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                const text = input.trim()
                if (text && !streaming) { setInput(''); void sendMessage(text) }
              }
            }}
            placeholder="Ask about your campaigns… (Enter to send)"
            rows={1}
            disabled={streaming || !!pendingTool}
            className="flex-1 resize-none rounded-xl border border-border-subtle bg-bg-secondary px-4 py-2.5 text-[13.5px] text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-60 min-h-[44px] max-h-32"
          />
          <Button type="submit" size="sm" disabled={!input.trim() || streaming || !!pendingTool} className="h-11 w-11 shrink-0 p-0">
            {streaming ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </Button>
        </form>
        <p className="mt-1.5 text-[11px] text-text-tertiary text-center">Mutations require approval before executing.</p>
      </div>
    </div>
  )
}
