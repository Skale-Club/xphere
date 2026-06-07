'use client'

// System-prompt editor for the "Prompt & Actions" section. Saving creates a
// draft version (savePromptDraft); the live version is promoted from the
// prompt-history page.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { History } from 'lucide-react'
import { toast } from 'sonner'

import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { savePromptDraft } from '@/app/(dashboard)/agents/_actions/prompts'

interface AgentPromptEditorProps {
  agentId: string
  initialPrompt: string
}

export function AgentPromptEditor({ agentId, initialPrompt }: AgentPromptEditorProps) {
  const router = useRouter()
  const [prompt, setPrompt] = useState(initialPrompt)
  // Baseline of the last-saved text so the button disables again after saving
  // (the server prop won't change identity within the same client instance).
  const [savedPrompt, setSavedPrompt] = useState(initialPrompt)
  const [isPending, startTransition] = useTransition()
  const dirty = prompt !== savedPrompt

  function saveDraft() {
    startTransition(async () => {
      const result = await savePromptDraft(agentId, prompt)
      if ('error' in result) {
        toast.error(result.error)
      } else {
        setSavedPrompt(prompt)
        toast.success(`Draft v${result.version} saved · publish from history to go live`)
        router.refresh()
      }
    })
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label className="text-sm font-medium text-text-primary">System prompt</label>
        <Link
          href={`/agents/${agentId}/prompt-history`}
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
        >
          <History className="h-3 w-3" />
          View history
        </Link>
      </div>
      <Textarea
        rows={14}
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        className="font-mono text-[13px]"
      />
      <div className="flex justify-end">
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={isPending || !dirty}
          onClick={saveDraft}
        >
          {isPending ? 'Saving…' : 'Save draft'}
        </Button>
      </div>
    </div>
  )
}
