'use client'

// @deprecated Legacy /email-marketing system, retired in favor of the
// block-based builder at /settings/email-templates (own AI generation via
// /api/email-templates/generate). Kept for existing data only — do not
// build new features against this. See
// .planning/workstreams/email-builder-hardening/PLAN.md Phase 5.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Sparkles, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { generateEmailFromPrompt } from '@/app/(dashboard)/email-marketing/_actions/generate'

const PROMPT_EXAMPLES = [
  'Email de boas-vindas para novos usuários do Xphere CRM',
  'Newsletter mensal com novidades do produto e dicas de uso',
  'Email promocional de Black Friday com 40% de desconto',
  'Anúncio de nova funcionalidade: integração com Google Calendar',
  'Email de reativação para usuários inativos há 30 dias',
]

export function AiGenerateForm() {
  const router = useRouter()
  const [name, setName] = useState('')
  const [prompt, setPrompt] = useState('')
  const [isPending, startTransition] = useTransition()

  function handleExample(example: string) {
    setPrompt(example)
    if (!name) setName(example.slice(0, 60))
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!prompt.trim() || !name.trim()) return

    startTransition(async () => {
      const toastId = toast.loading('Gerando email com IA…')
      const result = await generateEmailFromPrompt({ prompt, templateName: name })
      toast.dismiss(toastId)

      if (!result.ok) {
        toast.error(result.error)
        return
      }

      toast.success('Email gerado com sucesso!')
      router.push(`/email-marketing/${result.data.templateId}`)
    })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div className="space-y-1.5">
        <Label htmlFor="name">Nome do template</Label>
        <Input
          id="name"
          placeholder="ex: Welcome Email | Q3 2026"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          maxLength={120}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="prompt">Prompt para a IA</Label>
        <Textarea
          id="prompt"
          placeholder="Descreva o email que você quer gerar. Seja específico: objetivo, público, tom, produto, oferta…"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          required
          rows={5}
          className="resize-none"
        />
        <p className="text-[11px] text-muted-foreground">
          A IA irá gerar subject line, preview text e todas as seções HTML do email.
        </p>
      </div>

      {/* Example prompts */}
      <div className="space-y-1.5">
        <p className="text-xs font-medium text-muted-foreground">Exemplos rápidos</p>
        <div className="flex flex-wrap gap-1.5">
          {PROMPT_EXAMPLES.map((ex) => (
            <button
              key={ex}
              type="button"
              onClick={() => handleExample(ex)}
              className="text-[11px] px-2 py-1 rounded border border-border bg-muted/50 hover:bg-muted text-muted-foreground hover:text-foreground transition-colors text-left"
            >
              {ex}
            </button>
          ))}
        </div>
      </div>

      <Button type="submit" disabled={isPending || !prompt.trim() || !name.trim()} className="w-full gap-2">
        {isPending ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            Gerando…
          </>
        ) : (
          <>
            <Sparkles className="h-4 w-4" />
            Gerar com IA
          </>
        )}
      </Button>
    </form>
  )
}
