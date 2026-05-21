'use client'

import { useEffect, useRef, useState } from 'react'
import { Send, Pencil, ShieldCheck, RotateCcw, History } from 'lucide-react'
import Link from 'next/link'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { useCopilotStore } from '@/stores/copilot-store'
import { MessageBubble } from './message-bubble'
import { createConversation, getConversation } from '@/app/(dashboard)/copilot/_actions/conversations'
import { sendCopilotMessage } from '@/app/(dashboard)/copilot/_actions/turn'

export function CopilotSheet() {
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
  const scrollerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (scrollerRef.current) {
      scrollerRef.current.scrollTop = scrollerRef.current.scrollHeight
    }
  }, [messages])

  // Load conversation history when one is selected.
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

  async function handleSend() {
    const text = input.trim()
    if (!text || sending) return
    setSending(true)

    let activeConvId = conversationId
    if (!activeConvId) {
      const created = await createConversation()
      if (!created.ok) {
        setSending(false)
        appendMessage({
          id: tempId(),
          role: 'assistant',
          parts: [{ type: 'text', text: `Error: ${created.error}` }],
        })
        return
      }
      activeConvId = created.data.id
      setConversationId(activeConvId)
    }

    const userMsgId = tempId()
    appendMessage({
      id: userMsgId,
      role: 'user',
      parts: [{ type: 'text', text }],
    })
    setInput('')

    const assistantMsgId = tempId()
    appendMessage({
      id: assistantMsgId,
      role: 'assistant',
      parts: [],
      pending: true,
    })

    try {
      const res = await sendCopilotMessage({
        conversationId: activeConvId,
        message: text,
        writeMode,
      })
      if (res.ok) {
        updateMessage(assistantMsgId, {
          id: res.data.assistantMessageId,
          parts: res.data.assistantParts,
          pending: false,
          runId: res.data.runId,
          costUsd: res.data.costUsd,
        })
        addCost(res.data.costUsd)
      } else {
        updateMessage(assistantMsgId, {
          parts: [{ type: 'text', text: `Error: ${res.error}` }],
          pending: false,
        })
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      updateMessage(assistantMsgId, {
        parts: [{ type: 'text', text: `Error: ${msg}` }],
        pending: false,
      })
    } finally {
      setSending(false)
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void handleSend()
    }
  }

  const isEmpty = messages.length === 0

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetContent side="right" className="flex w-full max-w-md flex-col p-0 sm:max-w-lg">
        <SheetHeader className="border-b border-border px-4 py-3">
          <div className="flex items-center gap-2">
            <SheetTitle className="text-sm font-semibold">Copilot</SheetTitle>
            <div className="ml-auto flex items-center gap-1">
              {sessionCostUsd > 0 && (
                <span className="text-[11px] text-text-tertiary">
                  ~${sessionCostUsd.toFixed(4)}
                </span>
              )}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setWriteMode(!writeMode)}
                className={`h-7 gap-1 px-2 text-xs ${writeMode ? 'text-amber-600' : 'text-text-secondary'}`}
                title={writeMode ? 'Write mode ON | copilot may mutate data' : 'Read-only mode'}
              >
                {writeMode ? <Pencil className="h-3 w-3" /> : <ShieldCheck className="h-3 w-3" />}
                {writeMode ? 'Write' : 'Read-only'}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={newSession}
                className="h-7 px-2 text-xs"
                title="New conversation"
              >
                <RotateCcw className="h-3 w-3" />
              </Button>
              <Link
                href="/copilot/conversations"
                className="inline-flex h-7 items-center rounded-md px-2 text-xs text-text-secondary hover:bg-bg-tertiary"
                onClick={() => setOpen(false)}
                title="Conversation history"
              >
                <History className="h-3 w-3" />
              </Link>
            </div>
          </div>
        </SheetHeader>

        <div ref={scrollerRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
          {isEmpty && <GreetingPanel onPick={setInput} />}
          {messages.map((m) => (
            <MessageBubble key={m.id} message={m} />
          ))}
        </div>

        <div className="border-t border-border p-3">
          <div className="flex gap-2">
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={writeMode ? 'Ask the copilot…' : 'Ask the copilot… (read-only)'}
              rows={2}
              className="flex-1 resize-none text-sm"
              disabled={sending}
            />
            <Button
              onClick={handleSend}
              disabled={sending || !input.trim()}
              size="sm"
              className="self-end"
            >
              <Send className="h-3.5 w-3.5" />
            </Button>
          </div>
          <p className="mt-1 text-[10px] text-text-tertiary">
            Enter to send · Shift+Enter for newline · uses your org&apos;s OpenRouter/Anthropic key
          </p>
        </div>
      </SheetContent>
    </Sheet>
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
        Query, summarize, and (in write mode) mutate contacts, accounts, deals,
        tasks, and notes. Everything stays scoped to your active organization.
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

function tempId(): string {
  return `tmp_${Math.random().toString(36).slice(2)}`
}
