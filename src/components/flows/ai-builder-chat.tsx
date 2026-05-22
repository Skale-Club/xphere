'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Sparkles, Loader2, X, Send } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { useFlowStore } from '@/stores/flow-store'
import { aiBuildFlow } from '@/app/(dashboard)/workflows/flows/_actions/ai-build'
import { saveWorkflowDefinition } from '@/app/(dashboard)/workflows/flows/_actions/workflows'

const EXAMPLE_PROMPTS = [
  'When a new contact is created, send a welcome WhatsApp message',
  'Every Monday at 9am, query GHL for last week\'s opportunities',
  'When a booking is created, create a task for the assigned owner',
  'When SMS arrives from a Lost lead, send a follow-up and wait 24h',
]

interface AiBuilderChatProps {
  workflowId: string
  open: boolean
  onClose: () => void
}

export function AiBuilderChat({ workflowId, open, onClose }: AiBuilderChatProps) {
  const [prompt, setPrompt] = useState('')
  const [history, setHistory] = useState<Array<{ role: 'user' | 'assistant'; text: string; provider?: string }>>([])
  const [isPending, startTransition] = useTransition()

  const toDefinition = useFlowStore((s) => s.toDefinition)
  const hydrate = useFlowStore((s) => s.hydrate)
  const markSaved = useFlowStore((s) => s.markSaved)

  function handleSubmit(e?: React.FormEvent) {
    e?.preventDefault()
    if (!prompt.trim()) return

    const userPrompt = prompt.trim()
    setHistory((h) => [...h, { role: 'user', text: userPrompt }])
    setPrompt('')

    startTransition(async () => {
      const currentDefinition = toDefinition()
      const result = await aiBuildFlow({ prompt: userPrompt, currentDefinition })

      if (!result.ok) {
        toast.error(result.error)
        setHistory((h) => [...h, { role: 'assistant', text: `Error: ${result.error}` }])
        return
      }

      // Apply mutations and persist
      hydrate(workflowId, result.data.definition)
      const save = await saveWorkflowDefinition(workflowId, result.data.definition)
      if (save.ok) markSaved()

      setHistory((h) => [...h, {
        role: 'assistant',
        text: result.data.summary || 'Done. The canvas has been updated.',
        provider: result.data.provider,
      }])
    })
  }

  if (!open) return null

  return (
    <div className="w-80 border-l border-border bg-card shrink-0 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-border">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-indigo-400" />
          <span className="text-xs font-medium">AI Builder</span>
        </div>
        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={onClose}>
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* History */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {history.length === 0 && !isPending && (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Describe what your flow should do | the AI will build it on the canvas.
            </p>
            <div className="space-y-1.5">
              <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                Examples
              </p>
              {EXAMPLE_PROMPTS.map((ex) => (
                <button
                  key={ex}
                  type="button"
                  onClick={() => setPrompt(ex)}
                  className="block w-full text-left text-[11px] px-2 py-1.5 rounded border border-border bg-background hover:bg-muted/50 text-muted-foreground hover:text-foreground transition-colors"
                >
                  {ex}
                </button>
              ))}
            </div>
          </div>
        )}

        {history.map((msg, i) => (
          <div
            key={i}
            className={`text-xs rounded-md px-3 py-2 ${
              msg.role === 'user'
                ? 'bg-indigo-500/10 text-indigo-100 ml-4'
                : 'bg-muted/50 text-foreground mr-4'
            }`}
          >
            <p className="text-[9px] uppercase tracking-wider opacity-60 mb-1">
              {msg.role}
              {msg.provider && <span className="ml-1">· {msg.provider}</span>}
            </p>
            <p className="whitespace-pre-wrap leading-relaxed">{msg.text}</p>
          </div>
        ))}

        {isPending && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground mr-4">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Building…
          </div>
        )}
      </div>

      {/* Input */}
      <form onSubmit={handleSubmit} className="border-t border-border p-2 space-y-2">
        <Textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSubmit()
          }}
          placeholder="Describe your flow…  ⌘+Enter to send"
          rows={3}
          className="resize-none text-xs"
          disabled={isPending}
        />
        <Button
          type="submit"
          size="sm"
          className="w-full gap-1.5"
          disabled={isPending || !prompt.trim()}
        >
          {isPending ? (
            <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Building…</>
          ) : (
            <><Send className="h-3.5 w-3.5" /> Send</>
          )}
        </Button>
      </form>
    </div>
  )
}
