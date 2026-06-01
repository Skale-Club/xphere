'use client'

/**
 * TemplateComposerDialog — compose a WhatsApp Cloud message template and submit
 * it to Meta for approval (POST /{waba_id}/message_templates via the
 * createCloudTemplateAction server action). The new template lands as PENDING
 * until Meta reviews it; the approved status arrives via "Sync from Meta".
 *
 * v1 supports: name, category, language, optional text header, body with
 * {{n}} variables + examples, optional footer, optional URL / Quick Reply
 * buttons. Media headers are a follow-up (need Meta's resumable upload).
 */

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Loader2, Plus, Send, Trash2 } from 'lucide-react'

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { createCloudTemplateAction } from '@/app/(dashboard)/integrations/whatsapp/actions'

type Category = 'UTILITY' | 'MARKETING' | 'AUTHENTICATION'
type ButtonType = 'URL' | 'QUICK_REPLY'
interface ButtonDraft {
  type: ButtonType
  text: string
  url: string
}

const LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'en_US', label: 'English (US)' },
  { code: 'pt_BR', label: 'Português (BR)' },
  { code: 'es', label: 'Español' },
]

interface TemplateComposerDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated?: () => void
}

export function TemplateComposerDialog({
  open,
  onOpenChange,
  onCreated,
}: TemplateComposerDialogProps) {
  const [name, setName] = useState('')
  const [category, setCategory] = useState<Category>('UTILITY')
  const [language, setLanguage] = useState('en')
  const [headerText, setHeaderText] = useState('')
  const [bodyText, setBodyText] = useState('')
  const [bodyExamples, setBodyExamples] = useState<string[]>([])
  const [footerText, setFooterText] = useState('')
  const [buttons, setButtons] = useState<ButtonDraft[]>([])
  const [pending, startTransition] = useTransition()

  const varCount = (bodyText.match(/\{\{\d+\}\}/g) ?? []).length

  function reset() {
    setName('')
    setCategory('UTILITY')
    setLanguage('en')
    setHeaderText('')
    setBodyText('')
    setBodyExamples([])
    setFooterText('')
    setButtons([])
  }

  function handleOpenChange(next: boolean) {
    if (!next) reset()
    onOpenChange(next)
  }

  function addVariable() {
    const next = varCount + 1
    setBodyText((prev) => `${prev}{{${next}}}`)
    setBodyExamples((prev) => [...prev, ''])
  }

  function setExample(idx: number, value: string) {
    setBodyExamples((prev) => {
      const copy = [...prev]
      copy[idx] = value
      return copy
    })
  }

  const canSubmit =
    name.trim().length > 0 &&
    bodyText.trim().length > 0 &&
    (varCount === 0 || bodyExamples.slice(0, varCount).every((v) => v.trim())) &&
    buttons.every((b) => b.text.trim() && (b.type !== 'URL' || b.url.trim()))

  function handleSubmit() {
    if (!canSubmit) return
    startTransition(async () => {
      const res = await createCloudTemplateAction({
        name,
        category,
        language,
        headerText: headerText.trim() || null,
        bodyText,
        bodyExamples: bodyExamples.slice(0, varCount),
        footerText: footerText.trim() || null,
        buttons: buttons.map((b) => ({
          type: b.type,
          text: b.text.trim(),
          url: b.type === 'URL' ? b.url.trim() : undefined,
        })),
      })
      if (!res.ok) {
        toast.error(res.error)
        return
      }
      toast.success(`Template submitted — status: ${res.status}. Approval is decided by Meta.`)
      onCreated?.()
      handleOpenChange(false)
    })
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create WhatsApp template</DialogTitle>
          <DialogDescription>
            Submitted to Meta for approval. It becomes sendable once Meta approves it.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Name + Category + Language */}
          <div className="space-y-1.5">
            <Label className="text-[12px]">Template name</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="order_confirmation"
              className="h-9 text-[13px]"
            />
            <p className="text-[11px] text-text-tertiary">
              Lowercase letters, numbers and underscores only (auto-normalized).
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-[12px]">Category</Label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value as Category)}
                className="w-full h-9 px-3 rounded-[8px] border border-border bg-bg-secondary text-[13px] text-text-primary"
              >
                <option value="UTILITY">Utility</option>
                <option value="MARKETING">Marketing</option>
                <option value="AUTHENTICATION">Authentication</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-[12px]">Language</Label>
              <select
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
                className="w-full h-9 px-3 rounded-[8px] border border-border bg-bg-secondary text-[13px] text-text-primary"
              >
                {LANGUAGES.map((l) => (
                  <option key={l.code} value={l.code}>
                    {l.label} ({l.code})
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Header (text, optional) */}
          <div className="space-y-1.5">
            <Label className="text-[12px]">Header <span className="text-text-tertiary">(optional, text)</span></Label>
            <Input
              value={headerText}
              onChange={(e) => setHeaderText(e.target.value)}
              placeholder="e.g. Order update"
              className="h-9 text-[13px]"
            />
          </div>

          {/* Body */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label className="text-[12px]">Body</Label>
              <button
                type="button"
                onClick={addVariable}
                className="inline-flex items-center gap-1 text-[11.5px] text-accent hover:underline"
              >
                <Plus className="h-3 w-3" /> Add variable
              </button>
            </div>
            <textarea
              value={bodyText}
              onChange={(e) => setBodyText(e.target.value)}
              placeholder="Hi {{1}}, your order {{2}} has been shipped!"
              rows={4}
              className="w-full px-3 py-2 rounded-[8px] border border-border bg-bg-secondary text-[13px] text-text-primary resize-y"
            />
            {varCount > 0 && (
              <div className="space-y-2 pt-1">
                <p className="text-[11px] uppercase tracking-wide text-text-tertiary">
                  Example values (required by Meta)
                </p>
                {Array.from({ length: varCount }).map((_, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    <span className="text-[11px] font-mono text-text-tertiary w-12 shrink-0">
                      {'{{' + (idx + 1) + '}}'}
                    </span>
                    <Input
                      value={bodyExamples[idx] ?? ''}
                      onChange={(e) => setExample(idx, e.target.value)}
                      placeholder="Example value"
                      className="flex-1 h-9 text-[12.5px]"
                    />
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="space-y-1.5">
            <Label className="text-[12px]">Footer <span className="text-text-tertiary">(optional)</span></Label>
            <Input
              value={footerText}
              onChange={(e) => setFooterText(e.target.value)}
              placeholder="Reply STOP to unsubscribe"
              className="h-9 text-[13px]"
            />
          </div>

          {/* Buttons */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-[12px]">Buttons <span className="text-text-tertiary">(optional)</span></Label>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setButtons((p) => [...p, { type: 'URL', text: '', url: '' }])}
                  className="inline-flex items-center gap-1 text-[11.5px] text-accent hover:underline"
                >
                  <Plus className="h-3 w-3" /> URL
                </button>
                <button
                  type="button"
                  onClick={() => setButtons((p) => [...p, { type: 'QUICK_REPLY', text: '', url: '' }])}
                  className="inline-flex items-center gap-1 text-[11.5px] text-accent hover:underline"
                >
                  <Plus className="h-3 w-3" /> Quick Reply
                </button>
              </div>
            </div>
            {buttons.map((b, idx) => (
              <div key={idx} className="flex items-center gap-2">
                <span className="text-[10px] uppercase text-text-tertiary w-16 shrink-0">
                  {b.type === 'URL' ? 'URL' : 'Reply'}
                </span>
                <Input
                  value={b.text}
                  onChange={(e) =>
                    setButtons((p) => p.map((x, i) => (i === idx ? { ...x, text: e.target.value } : x)))
                  }
                  placeholder="Button text"
                  className="flex-1 h-9 text-[12.5px]"
                />
                {b.type === 'URL' && (
                  <Input
                    value={b.url}
                    onChange={(e) =>
                      setButtons((p) => p.map((x, i) => (i === idx ? { ...x, url: e.target.value } : x)))
                    }
                    placeholder="https://…"
                    className="flex-1 h-9 text-[12.5px]"
                  />
                )}
                <button
                  type="button"
                  onClick={() => setButtons((p) => p.filter((_, i) => i !== idx))}
                  className="text-text-tertiary hover:text-rose-400"
                  aria-label="Remove button"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2 border-t border-border">
          <Button variant="ghost" onClick={() => handleOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={!canSubmit || pending} className="gap-1.5">
            {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
            Create Template
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
