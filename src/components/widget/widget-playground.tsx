'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { MessageSquare, X, ArrowUp, Share2, RefreshCw, Copy, Check, Maximize2, Minimize2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { WIDGET_THEME as T } from '@/widget/theme'

interface WidgetPlaygroundProps {
  widgetToken: string
  displayName: string
  primaryColor: string
  welcomeMessage: string
  avatarUrl?: string | null
  greetingEnabled?: boolean
  greetingMessage?: string
  greetingDelaySeconds?: number
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
  greetingEnabled = true,
  greetingDelaySeconds = 3,
}: WidgetPlaygroundProps) {
  const [open, setOpen] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [embedOpen, setEmbedOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const [copiedToken, setCopiedToken] = useState(false)
  const [messages, setMessages] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [debugTraceId, setDebugTraceId] = useState<string | null>(null)
  const [greetingVisible, setGreetingVisible] = useState(false)
  const [greetingInput, setGreetingInput] = useState('')
  const [greetingHover, setGreetingHover] = useState(false)
  const listRef = useRef<HTMLDivElement | null>(null)

  // Mirror the real widget: show the greeting composer after the delay when
  // closed. Re-runs when settings change so the preview reflects edits live.
  useEffect(() => {
    if (!greetingEnabled || open) { setGreetingVisible(false); return }
    setGreetingVisible(false)
    const t = setTimeout(() => setGreetingVisible(true), Math.max(0, greetingDelaySeconds) * 1000)
    return () => clearTimeout(t)
  }, [greetingEnabled, greetingDelaySeconds, open])

  function sendFromGreeting() {
    const text = greetingInput.trim()
    if (!text) return
    setGreetingInput('')
    setGreetingVisible(false)
    setOpen(true)
    void send(text)
  }

  const snippet = `<script src="https://xphere.app/widget.js" data-token="${widgetToken}"></script>`

  async function copyText(text: string, setFlag: (v: boolean) => void) {
    try {
      await navigator.clipboard.writeText(text)
      setFlag(true)
      setTimeout(() => setFlag(false), 1600)
    } catch {
      try {
        const ta = document.createElement('textarea')
        ta.value = text
        ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0'
        document.body.appendChild(ta)
        ta.select()
        document.execCommand('copy')
        document.body.removeChild(ta)
        setFlag(true)
        setTimeout(() => setFlag(false), 1600)
      } catch {
        toast.error('Could not copy to clipboard.')
      }
    }
  }

  const initials = displayName.trim().slice(0, 2).toUpperCase() || 'AI'

  const reset = useCallback(() => {
    setMessages([])
    setDebugTraceId(null)
    setInput('')
  }, [])

  // Auto-scroll to bottom on new content.
  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight
  }, [messages, sending])

  async function send(overrideText?: string) {
    const text = (overrideText ?? input).trim()
    if (!text || sending) return
    setInput('')
    setMessages((prev) => [...prev, { role: 'user', content: text }, { role: 'assistant', content: '' }])
    setSending(true)

    // Build history for context (all messages except the last placeholder)
    const history = messages.slice(0, -1).map((m) => ({ role: m.role, content: m.content }))

    try {
      const res = await fetch('/api/widget/playground', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ widgetToken, message: text, history }),
      })

      if (!res.ok || !res.body) {
        setMessages((prev) => {
          const next = [...prev]
          next[next.length - 1] = { role: 'assistant', content: '⚠️ Could not reach the assistant.' }
          return next
        })
        return
      }

      // Stream parser: newline-delimited JSON
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let gotToken = false

      const handle = (evt: SSEEvent) => {
        if (evt.event === 'session' && evt.sessionId) {
          // playground endpoint emits traceId in the sessionId field for debug
          setDebugTraceId(evt.sessionId)
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
            Sandbox — messages here never appear in the Chat inbox.
          </p>
        </div>
        <div className="relative">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setEmbedOpen((v) => !v)}
            className="gap-1.5"
          >
            <Share2 className="h-3.5 w-3.5" />
            Share
          </Button>

          {embedOpen && (
            <>
              <button
                type="button"
                aria-label="Close share panel"
                className="fixed inset-0 z-20 cursor-default"
                onClick={() => setEmbedOpen(false)}
              />
              <div className="absolute right-0 top-full z-30 mt-2 w-[min(460px,78vw)] overflow-hidden rounded-[10px] border border-border bg-bg-primary shadow-xl">
                <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
                  <p className="text-[12px] text-text-tertiary">
                    Paste before <code className="rounded bg-bg-tertiary px-1 py-0.5 font-mono text-[11px]">&lt;/body&gt;</code>
                  </p>
                  <div className="flex items-center gap-1.5">
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => void copyText(widgetToken, setCopiedToken)}
                      className="h-7 gap-1 text-[11.5px]"
                      title="Copy just the widget token (ID)"
                    >
                      {copiedToken ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                      {copiedToken ? 'Copied ID' : 'Copy ID'}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      onClick={() => void copyText(snippet, setCopied)}
                      className="h-7 gap-1 text-[11.5px]"
                    >
                      {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                      {copied ? 'Copied' : 'Copy'}
                    </Button>
                  </div>
                </div>
                <pre className="max-h-48 overflow-auto bg-zinc-950 p-4 font-mono text-[11px] leading-relaxed text-zinc-100">
                  <code>{snippet}</code>
                </pre>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Stage — neutral backdrop with the widget anchored bottom-right */}
      <div
        className="relative overflow-hidden rounded-[16px] border border-border-subtle"
        style={{
          height: 520,
          backgroundColor: T.stageBg,
          backgroundImage: T.stageDots,
          backgroundSize: T.stageDotsSize,
        }}
      >
        {/* Bottom-left: Reset + debug traceId */}
        <div className="absolute bottom-4 left-4 z-10 flex flex-col items-start gap-1">
          <button
            type="button"
            onClick={reset}
            aria-label="Reset conversation"
            className="flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 text-[11.5px] font-medium text-white/60 transition-colors hover:bg-white/20 hover:text-white/90"
          >
            <RefreshCw className="h-3 w-3" />
            Reset
          </button>
        </div>

        {/* Floating bubble — always mounted, fades out when open */}
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Open chat"
          className="absolute bottom-4 right-4 flex h-14 w-14 items-center justify-center rounded-full text-white shadow-lg transition-all duration-300 hover:scale-105"
          style={{
            backgroundColor: primaryColor,
            opacity: open ? 0 : 1,
            transform: open ? 'scale(0.7)' : 'scale(1)',
            pointerEvents: open ? 'none' : 'auto',
          }}
        >
          <MessageSquare className="h-6 w-6" />
        </button>

        {/* Greeting composer — slides in beside the bubble after the delay */}
        <div
          className="absolute right-[5.5rem] flex max-w-[300px] justify-end"
          onMouseEnter={() => setGreetingHover(true)}
          onMouseLeave={() => setGreetingHover(false)}
          style={{
            // Anchored to the bubble centerline (bottom-4 = 16px + 56/2) and
            // shifted down 50% of its own height to center on the bubble.
            bottom: 44,
            transformOrigin: 'bottom right',
            transition: 'opacity 280ms cubic-bezier(0.34,1.56,0.64,1), transform 280ms cubic-bezier(0.34,1.56,0.64,1)',
            opacity: greetingVisible && !open ? 1 : 0,
            transform: greetingVisible && !open ? 'translateY(50%) scale(1)' : 'translateY(calc(50% + 12px)) scale(0.96)',
            pointerEvents: greetingVisible && !open ? 'auto' : 'none',
          }}
        >
          <div className="relative flex items-center before:absolute before:-top-9 before:left-0 before:right-0 before:h-10 before:content-['']">
            <button
              type="button"
              onClick={() => setGreetingVisible(false)}
              aria-label="Dismiss greeting"
              className="absolute z-10 flex items-center justify-center rounded-full bg-[#2e2e2e] text-white shadow hover:bg-[#242424]"
              style={{
                width: 22,
                height: 22,
                top: -28,
                left: -6,
                // Destination (hovered) = crisp: no blur, full opacity. The blur +
                // alpha exist only as the appear/disappear transition.
                opacity: greetingHover ? 1 : 0,
                filter: greetingHover ? 'blur(0px)' : 'blur(4px)',
                pointerEvents: greetingHover ? 'auto' : 'none',
                transition: 'opacity 200ms ease, filter 200ms ease',
              }}
            >
              <X className="h-3 w-3" />
            </button>
            <div className="flex w-[264px] max-w-[72vw] items-center gap-1.5 rounded-full border border-zinc-200 bg-white py-1 pl-4 pr-1 shadow-lg">
              <input
                value={greetingInput}
                onChange={(e) => setGreetingInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); sendFromGreeting() } }}
                placeholder="Write a message…"
                aria-label="Write a message"
                className="h-8 flex-1 border-0 bg-transparent text-[13px] text-zinc-900 outline-none placeholder:text-zinc-400"
              />
              <button
                type="button"
                onClick={sendFromGreeting}
                disabled={!greetingInput.trim()}
                aria-label="Send"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-white disabled:opacity-50"
                style={{ backgroundColor: primaryColor }}
              >
                <ArrowUp className="h-4 w-4" strokeWidth={2.5} />
              </button>
            </div>
          </div>
        </div>

        {/* Chat panel — always mounted, animates in/out */}
        <div
          className="absolute bottom-4 right-4 flex max-w-[calc(100%-2rem)] flex-col overflow-hidden rounded-[18px] shadow-2xl"
          style={{
            background: T.panelBg,
            width: expanded ? 420 : 340,
            height: expanded ? 488 : 460,
            transformOrigin: 'bottom right',
            transition: 'opacity 280ms cubic-bezier(0.34,1.56,0.64,1), transform 280ms cubic-bezier(0.34,1.56,0.64,1), width 240ms cubic-bezier(0.2,0,0,1), height 240ms cubic-bezier(0.2,0,0,1)',
            opacity: open ? 1 : 0,
            transform: open ? 'scale(1) translateY(0)' : 'scale(0.85) translateY(16px)',
            pointerEvents: open ? 'auto' : 'none',
          }}
        >
            {/* Header */}
            <div className="flex items-center gap-3 px-6 py-3 text-white" style={{ backgroundColor: primaryColor }}>
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
              <button
                type="button"
                onClick={() => setExpanded((v) => !v)}
                aria-label={expanded ? 'Collapse chat' : 'Expand chat'}
                className="rounded p-1 text-white/80 hover:text-white"
              >
                {expanded ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
              </button>
              <button type="button" onClick={() => setOpen(false)} aria-label="Close chat" className="rounded p-1 text-white/80 hover:text-white">
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Messages */}
            <div ref={listRef} className="flex-1 space-y-2.5 overflow-y-auto p-6" style={{ background: T.panelBg }}>
              <div className="max-w-[85%] px-1 py-0.5 text-[13px] text-zinc-900">
                {welcomeMessage || 'Hi! How can I help?'}
              </div>
              {messages.map((m, i) =>
                m.role === 'user' ? (
                  <div key={i} className="ml-auto w-fit max-w-[80%] rounded-[10px] px-3.5 py-2.5 text-[13px] text-white" style={{ backgroundColor: primaryColor }}>
                    {m.content}
                  </div>
                ) : (
                  <div key={i} className="max-w-[85%] px-1 py-0.5 text-[13px] text-zinc-900">
                    {m.content || (sending && i === messages.length - 1 ? <TypingDots /> : '')}
                  </div>
                ),
              )}
            </div>

            {/* Input */}
            <div className="flex items-center gap-2 p-6" style={{ background: T.panelBg }}>
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
                <ArrowUp className="h-4 w-4" strokeWidth={2.5} />
              </button>
            </div>
          </div>
      </div>

      {/* Chat session ID — shown below the frame once a conversation starts */}
      {debugTraceId && (
        <div className="flex items-center gap-2 px-1">
          <span className="text-[11px] text-text-tertiary shrink-0">Session ID</span>
          <code className="flex-1 truncate rounded bg-bg-tertiary px-2 py-0.5 font-mono text-[11px] text-text-secondary">
            {debugTraceId}
          </code>
        </div>
      )}
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
