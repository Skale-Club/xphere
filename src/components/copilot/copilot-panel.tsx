'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import {
  Send, Pencil, ShieldCheck, RotateCcw, History, X,
  Mic, MicOff, ImagePlus, Loader2,
} from 'lucide-react'
import Link from 'next/link'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { useCopilotStore } from '@/stores/copilot-store'
import { MessageBubble } from './message-bubble'
import { createConversation, getConversation } from '@/app/(dashboard)/copilot/_actions/conversations'
import { sendCopilotMessage } from '@/app/(dashboard)/copilot/_actions/turn'

// ─── Image helpers ────────────────────────────────────────────────────────────

function compressImage(file: File, maxPx = 1024): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      URL.revokeObjectURL(url)
      const scale = Math.min(1, maxPx / Math.max(img.width, img.height))
      const w = Math.round(img.width * scale)
      const h = Math.round(img.height * scale)
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      canvas.getContext('2d')!.drawImage(img, 0, 0, w, h)
      resolve(canvas.toDataURL('image/jpeg', 0.82))
    }
    img.onerror = reject
    img.src = url
  })
}

// ─── Panel (desktop sidebar + mobile fullscreen) ──────────────────────────────

export function CopilotPanel() {
  const {
    open, setOpen,
    conversationId, setConversationId,
    messages, resetMessages, appendMessage, updateMessage,
    writeMode, setWriteMode,
    sending, setSending,
    sessionCostUsd, addCost,
    newSession,
  } = useCopilotStore()

  const [input, setInput] = useState('')
  const [images, setImages] = useState<string[]>([])         // compressed base64
  const [listening, setListening] = useState(false)
  const [, startSend] = useTransition()
  const scrollerRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recognitionRef = useRef<any>(null)

  useEffect(() => {
    if (scrollerRef.current) {
      scrollerRef.current.scrollTop = scrollerRef.current.scrollHeight
    }
  }, [messages])

  useEffect(() => {
    if (!conversationId) return
    let cancelled = false
    void (async () => {
      const res = await getConversation(conversationId)
      if (!cancelled && res.ok) {
        resetMessages(
          res.data.messages.map((m) => ({
            id: m.id,
            role: m.role,
            parts: m.parts,
          })),
        )
      }
    })()
    return () => { cancelled = true }
  }, [conversationId, resetMessages])

  // ── Audio / speech-to-text ─────────────────────────────────────────────────

  function toggleMic() {
    if (listening) {
      recognitionRef.current?.stop()
      return
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any
    const SR = w.SpeechRecognition ?? w.webkitSpeechRecognition
    if (!SR) {
      alert('Voice input is not supported in this browser.')
      return
    }
    const rec = new SR()
    rec.lang = 'pt-BR'
    rec.interimResults = false
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rec.onresult = (e: any) => {
      const transcript = Array.from(e.results as unknown[])
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .map((r: any) => r[0].transcript as string)
        .join(' ')
      setInput((prev) => (prev ? `${prev} ${transcript}` : transcript))
    }
    rec.onend = () => setListening(false)
    rec.onerror = () => setListening(false)
    rec.start()
    recognitionRef.current = rec
    setListening(true)
  }

  // ── Image picker ───────────────────────────────────────────────────────────

  async function handleImageFiles(files: FileList | null) {
    if (!files) return
    const compressed = await Promise.all(
      Array.from(files).slice(0, 4).map((f) => compressImage(f))
    )
    setImages((prev) => [...prev, ...compressed].slice(0, 4))
  }

  function removeImage(idx: number) {
    setImages((prev) => prev.filter((_, i) => i !== idx))
  }

  // ── Send ───────────────────────────────────────────────────────────────────

  async function handleSend() {
    const text = input.trim()
    if ((!text && images.length === 0) || sending) return
    setSending(true)

    let activeConvId = conversationId
    if (!activeConvId) {
      const created = await createConversation()
      if (!created.ok) {
        setSending(false)
        appendMessage({ id: tempId(), role: 'assistant', parts: [{ type: 'text', text: `Error: ${created.error}` }] })
        return
      }
      activeConvId = created.data.id
      setConversationId(activeConvId)
    }

    const sentImages = [...images]
    appendMessage({
      id: tempId(),
      role: 'user',
      parts: [
        { type: 'text', text: text || '(image)' },
        ...sentImages.map((url) => ({ type: 'image' as const, url })),
      ],
    })
    setInput('')
    setImages([])

    const assistantMsgId = tempId()
    appendMessage({ id: assistantMsgId, role: 'assistant', parts: [], pending: true })

    startSend(async () => {
      try {
        const res = await sendCopilotMessage({
          conversationId: activeConvId!,
          message: text || '(describe the image)',
          images: sentImages.length > 0 ? sentImages : undefined,
          writeMode,
        })
        if (res.ok) {
          updateMessage(assistantMsgId, { id: res.data.assistantMessageId, parts: res.data.assistantParts, pending: false, runId: res.data.runId, costUsd: res.data.costUsd })
          addCost(res.data.costUsd)
        } else {
          updateMessage(assistantMsgId, { parts: [{ type: 'text', text: `Error: ${res.error}` }], pending: false })
        }
      } catch (err) {
        updateMessage(assistantMsgId, { parts: [{ type: 'text', text: `Error: ${err instanceof Error ? err.message : String(err)}` }], pending: false })
      } finally {
        setSending(false)
      }
    })
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void handleSend() }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  const panelContent = (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-border px-4 py-3 shrink-0">
        <span className="text-sm font-semibold text-text-primary">Copilot</span>
        <div className="ml-auto flex items-center gap-1">
          {sessionCostUsd > 0 && (
            <span className="text-[11px] text-text-tertiary">~${sessionCostUsd.toFixed(4)}</span>
          )}
          <Button
            variant="ghost" size="sm"
            onClick={() => setWriteMode(!writeMode)}
            className={cn('h-7 gap-1 px-2 text-xs', writeMode ? 'text-amber-500' : 'text-text-secondary')}
            title={writeMode ? 'Write mode ON' : 'Read-only mode'}
          >
            {writeMode ? <Pencil className="h-3 w-3" /> : <ShieldCheck className="h-3 w-3" />}
            <span className="hidden sm:inline">{writeMode ? 'Write' : 'Read-only'}</span>
          </Button>
          <Button variant="ghost" size="sm" onClick={newSession} className="h-7 px-2" title="New conversation">
            <RotateCcw className="h-3 w-3" />
          </Button>
          <Link
            href="/copilot/conversations"
            className="inline-flex h-7 items-center rounded-md px-2 text-text-secondary hover:bg-bg-tertiary"
            onClick={() => setOpen(false)}
            title="History"
          >
            <History className="h-3 w-3" />
          </Link>
          <Button variant="ghost" size="sm" onClick={() => setOpen(false)} className="h-7 px-2">
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Messages */}
      <div ref={scrollerRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-3 min-h-0">
        {messages.length === 0 && <GreetingPanel onPick={setInput} />}
        {messages.map((m) => <MessageBubble key={m.id} message={m} />)}
      </div>

      {/* Input area */}
      <div className="border-t border-border p-3 shrink-0">
        {/* Image previews */}
        {images.length > 0 && (
          <div className="flex gap-2 mb-2 flex-wrap">
            {images.map((src, i) => (
              <div key={i} className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={src} alt="" className="h-14 w-14 rounded-lg object-cover border border-border" />
                <button
                  type="button"
                  onClick={() => removeImage(i)}
                  className="absolute -top-1.5 -right-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-bg-primary border border-border text-text-tertiary hover:text-text-primary"
                >
                  <X className="h-2.5 w-2.5" />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Text row */}
        <div className="flex gap-2 items-end">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={listening ? 'Listening…' : 'Ask Copilot…'}
            rows={2}
            className="flex-1 resize-none text-sm"
            disabled={sending}
          />
          <div className="flex flex-col gap-1.5">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-8 w-8 p-0"
              onClick={() => fileInputRef.current?.click()}
              title="Attach image"
              disabled={sending || images.length >= 4}
            >
              <ImagePlus className="h-4 w-4 text-text-secondary" />
            </Button>
            <Button
              type="button"
              size="sm"
              variant={listening ? 'secondary' : 'ghost'}
              className={cn('h-8 w-8 p-0', listening && 'text-red-500 animate-pulse')}
              onClick={toggleMic}
              title={listening ? 'Stop recording' : 'Voice input'}
              disabled={sending}
            >
              {listening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4 text-text-secondary" />}
            </Button>
            <Button
              size="sm"
              onClick={handleSend}
              disabled={sending || (!input.trim() && images.length === 0)}
              className="h-8 w-8 p-0"
              title="Send"
            >
              {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
            </Button>
          </div>
        </div>

        <p className="mt-1.5 text-[10px] text-text-tertiary">
          Enter to send · Shift+Enter for newline · ⌘I to toggle
        </p>
      </div>

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => { void handleImageFiles(e.target.files); e.target.value = '' }}
      />
    </div>
  )

  return (
    <>
      {/* Desktop: right sidebar that pushes the layout */}
      <aside
        className={cn(
          'hidden md:flex flex-col border-l border-border bg-bg-primary',
          'transition-[width] duration-200 ease-in-out overflow-hidden shrink-0',
          open ? 'w-[380px]' : 'w-0',
        )}
      >
        <div className="w-[380px] h-full">{panelContent}</div>
      </aside>

      {/* Mobile: fixed full-screen overlay */}
      {open && (
        <div className="md:hidden fixed inset-0 z-50 bg-bg-primary flex flex-col">
          {panelContent}
        </div>
      )}
    </>
  )
}

function GreetingPanel({ onPick }: { onPick: (text: string) => void }) {
  const suggestions = [
    'List my 10 most recent contacts',
    'Summarize pipeline health',
    'Show all open tasks due this week',
    'Find duplicate contacts by email',
  ]
  return (
    <div className="rounded-lg border border-border bg-bg-secondary p-4 text-sm">
      <p className="font-medium text-text-primary">Chat with your CRM.</p>
      <p className="mt-1 text-xs text-text-secondary">
        Query, summarize, and (in write mode) mutate contacts, deals, tasks, and notes.
        Attach images or use your mic to ask anything.
      </p>
      <div className="mt-3 grid grid-cols-1 gap-1.5">
        {suggestions.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => onPick(s)}
            className="rounded-md border border-border bg-bg-primary px-2.5 py-1.5 text-left text-xs hover:bg-bg-tertiary"
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  )
}

function tempId() {
  return `tmp_${Math.random().toString(36).slice(2)}`
}
