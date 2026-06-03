'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { MessageSquare, X, RefreshCw, Send, Share2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'

interface WidgetPlaygroundProps {
  widgetToken: string
  displayName: string
  primaryColor: string
  welcomeMessage: string
  avatarUrl?: string | null
}

type Msg = { role: 'user' | 'assistant'; content: string }

interface SSEEvent {
  event: string
  sessionId?: string
  text?: string
}

export function WidgetPlayground({
  widgetToken,
  displayName,
  primaryColor,
  welcomeMessage,
  avatarUrl,
}: WidgetPlaygroundProps) {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)

  const initials = displayName.trim().slice(0, 2).toUpperCase() || 'AI'

  const reset = useCallback(() => {
    setMessages([])
    setSessionId(null)
    setInput('')
    setOpen(false)
  }, [])

  function share() {
    const url = `https://xphere.app/book`  // placeholder — use widget embed URL
    const embedCode = `<script src="https://xphere.app/widget.js" data-token="${widgetToken}"></script>`
    void navigator.clipboard.writeText(embedCode).then(() => {
      toast.success('Embed code copied to clipboard.')
    }).catch(() => {
      toast.error('Could not copy to clipboard.')
    })
  }

  // Auto-scroll to bottom on new content.
  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight
  }, [messages, sending])

  async function send() {
    const text = input.trim()
    if (!text || sending) return
    setInput('')
    setMessages((prev) => [...prev, { role: 'user', content: text }, { role: 'assistant', content: '' }])
    setSending(true)

    try {
      const res = await fetch(`/api/chat/${widgetToken}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, ...(sessionId ? { sessionId } : {}) }),
      })

      if (!res.ok || !res.body) {
        setMessages((prev) => {
          const next = [...prev]
          next[next.length - 1] = { role: 'assistant', content: '⚠️ Could not reach the assistant.' }
          return next
        })
        return
      }

      // Stream parser: newline-delimited JSON (mirrors src/widget/index.ts consumeStream).
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let gotToken = false

      const handle = (evt: SSEEvent) => {
        if (evt.event === 'session' && evt.sessionId) {
          setSessionId((s) => s ?? evt.sessionId!)
        } else if (evt.event === 'token' && evt.text) {
          gotToken = true
          setMessages((prev) => {
            const next = [...prev]
            const last = next[next.length - 1]
            if (last?.role === 'assistant') next[next.length - 1] = { ...last, content: last.content + evt.text }
            return next
          })
        } else if (evt.event === 'error') {
          setMessages((prev) => {
            const next = [...prev]
            next[next.length - 1] = { role: 'assistant', content: '⚠️ The assistant returned an error.' }
            return next
          })
        }
      }

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const parts = buffer.split('\n')
        buffer = parts.pop() ?? ''
        for (const part of parts) {
          const t = part.trim()
          if (!t) continue
          try { handle(JSON.parse(t) as SSEEvent) } catch { /* skip */ }
        }
      }
      if (buffer.trim()) {
        try { handle(JSON.parse(buffer.trim()) as SSEEvent) } catch { /* skip */ }
      }

      // No tokens streamed (e.g. no agent linked) → friendly hint.
      if (!gotToken) {
        setMessages((prev) => {
          const next = [...prev]
          const last = next[next.length - 1]
          if (last?.role === 'assistant' && !last.content) {
            next[next.length - 1] = {
              role: 'assistant',
              content: 'No agent is linked to this widget yet. Pick one in the “AI Agent” section to get replies.',
            }
          }
          return next
        })
      }
    } catch {
      setMessages((prev) => {
        const next = [...prev]
        next[next.length - 1] = { role: 'assistant', content: '⚠️ Network error.' }
        return next
      })
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[13.5px] font-semibold text-text-primary">Test your widget</p>
          <p className="text-[12px] text-text-tertiary mt-0.5">
            Click the bubble to open and test a real conversation.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={share} className="gap-1.5">
            <Share2 className="h-3.5 w-3.5" />
            Share
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={reset} className="gap-1.5">
            <RefreshCw className="h-3.5 w-3.5" />
            Reset
          </Button>
        </div>
      </div>

      {/* Stage — neutral backdrop with the widget anchored bottom-right */}
      <div className="relative overflow-hidden rounded-[16px] border border-border-subtle bg-[#0f0f11]" style={{ height: 520 }}>
        {/* Closed: floating bubble */}
        {!open && (
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-label="Open chat"
            className="absolute bottom-4 right-4 flex h-14 w-14 items-center justify-center rounded-full text-white shadow-lg transition-transform hover:scale-105"
            style={{ backgroundColor: primaryColor }}
          >
            <MessageSquare className="h-6 w-6" />
          </button>
        )}

        {/* Open: chat panel */}
        {open && (
          <div className="absolute bottom-4 right-4 flex w-[340px] max-w-[calc(100%-2rem)] flex-col overflow-hidden rounded-[18px] bg-white shadow-2xl" style={{ height: 460 }}>
            {/* Header */}
            <div className="flex items-center gap-3 px-4 py-3 text-white" style={{ backgroundColor: primaryColor }}>
              <div className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-full bg-white/20 text-xs font-semibold">
                {avatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={avatarUrl} alt="" className="h-full w-full object-cover" />
                ) : (
                  initials
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13.5px] font-semibold leading-tight">{displayName || 'AI Assistant'}</p>
                <p className="text-[11px] text-white/80">Usually replies in a few seconds</p>
              </div>
              <button type="button" onClick={() => setOpen(false)} aria-label="Close chat" className="rounded p-1 text-white/80 hover:text-white">
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Messages */}
            <div ref={listRef} className="flex-1 space-y-2.5 overflow-y-auto bg-zinc-50 px-3 py-3">
              <div className="max-w-[85%] rounded-2xl rounded-tl-md bg-white px-3.5 py-2.5 text-[13px] text-zinc-900 shadow-sm">
                {welcomeMessage || 'Hi! How can I help?'}
              </div>
              {messages.map((m, i) =>
                m.role === 'user' ? (
                  <div key={i} className="ml-auto max-w-[80%] rounded-2xl rounded-br-md px-3.5 py-2.5 text-[13px] text-white" style={{ backgroundColor: primaryColor }}>
                    {m.content}
                  </div>
                ) : (
                  <div key={i} className="max-w-[85%] rounded-2xl rounded-tl-md bg-white px-3.5 py-2.5 text-[13px] text-zinc-900 shadow-sm">
                    {m.content || (sending && i === messages.length - 1 ? <TypingDots /> : '')}
                  </div>
                ),
              )}
            </div>

            {/* Input */}
            <div className="flex items-center gap-2 border-t bg-white px-3 py-2.5">
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void send() } }}
                placeholder="Type your message…"
                disabled={sending}
                className="h-9 flex-1 rounded-full border border-zinc-200 bg-zinc-50 px-3.5 text-[13px] text-zinc-900 outline-none placeholder:text-zinc-400 focus:border-zinc-300 disabled:opacity-60"
              />
              <button
                type="button"
                onClick={() => void send()}
                disabled={sending || !input.trim()}
                aria-label="Send"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white disabled:opacity-50"
                style={{ backgroundColor: primaryColor }}
              >
                <Send className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function TypingDots() {
  return (
    <span className="inline-flex items-center gap-1">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="h-1.5 w-1.5 rounded-full bg-zinc-400"
          style={{ animation: 'opps-bounce 1s infinite', animationDelay: `${i * 0.15}s` }}
        />
      ))}
      <style>{`@keyframes opps-bounce { 0%,80%,100%{opacity:.3;transform:translateY(0)} 40%{opacity:1;transform:translateY(-3px)} }`}</style>
    </span>
  )
}
