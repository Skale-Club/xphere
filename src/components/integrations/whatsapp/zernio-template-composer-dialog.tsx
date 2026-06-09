'use client'

/**
 * ZernioTemplateComposerDialog — compose a WhatsApp message template and
 * submit it to Meta for approval via the Zernio API. The template lands as
 * PENDING until Meta reviews it; use "Sync" on the templates page to refresh.
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
import { createZernioTemplateAction } from '@/app/(dashboard)/integrations/whatsapp/actions'

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

interface ZernioTemplateComposerDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  accountId: string
  onCreated?: () => void
}

export function ZernioTemplateComposerDialog({
  open,
  onOpenChange,
  accountId,
  onCreated,
}: ZernioTemplateComposerDialogProps) {
  const [name, setName] = useState('')
  const [category, setCategory] = useState<Category>('UTILITY')
  const [language, setLanguage] = useState('en')
  const [headerText, setHeaderText] = useState('')
  const [bodyText, setBodyText] = useState('')
  const [footerText, setFooterText] = useState('')
  const [libraryTemplateName, setLibraryTemplateName] = useState('')
  const [buttons, setButtons] = useState<ButtonDraft[]>([])
  const [pending, startTransition] = useTransition()

  function reset() {
    setName('')
    setCategory('UTILITY')
    setLanguage('en')
    setHeaderText('')
    setBodyText('')
    setFooterText('')
    setLibraryTemplateName('')
    setButtons([])
  }

  function handleOpenChange(next: boolean) {
    if (!next) reset()
    onOpenChange(next)
  }

  function addVariable() {
    const count = (bodyText.match(/\{\{\d+\}\}/g) ?? []).length
    setBodyText((prev) => `${prev}{{${count + 1}}}`)
  }

  const canSubmit =
    name.trim().length > 0 &&
    bodyText.trim().length > 0 &&
    buttons.every((b) => b.text.trim() && (b.type !== 'URL' || b.url.trim()))

  function handleSubmit() {
    if (!canSubmit) return
    startTransition(async () => {
      const res = await createZernioTemplateAction({
        accountId,
        name,
        category,
        language,
        headerText: headerText.trim() || null,
        bodyText,
        footerText: footerText.trim() || null,
        libraryTemplateName: libraryTemplateName.trim() || null,
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
      toast.success(`Template submitted — status: ${res.status}. Meta reviews within ~24h.`)
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
            Submitted via Zernio to Meta for approval. Sendable once approved.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Name */}
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

          {/* Category + Language */}
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

          {/* Library Template (optional) */}
          <div className="space-y-1.5">
            <Label className="text-[12px]">
              Library Template{' '}
              <span className="text-text-tertiary">(optional)</span>
            </Label>
            <Input
              value={libraryTemplateName}
              onChange={(e) => setLibraryTemplateName(e.target.value)}
              placeholder="e.g. appointment_reminder"
              className="h-9 text-[13px]"
            />
            <p className="text-[11px] text-text-tertiary">
              Paste a name from Meta&apos;s template library to use a pre-built template instead of writing your own.
            </p>
          </div>

          {/* Header (text, optional) */}
          <div className="space-y-1.5">
            <Label className="text-[12px]">
              Header <span className="text-text-tertiary">(optional, text)</span>
            </Label>
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
          </div>

          {/* Footer */}
          <div className="space-y-1.5">
            <Label className="text-[12px]">
              Footer <span className="text-text-tertiary">(optional)</span>
            </Label>
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
              <Label className="text-[12px]">
                Buttons <span className="text-text-tertiary">(optional)</span>
              </Label>
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
                  onClick={() =>
                    setButtons((p) => [...p, { type: 'QUICK_REPLY', text: '', url: '' }])
                  }
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
                      setButtons((p) =>
                        p.map((x, i) => (i === idx ? { ...x, url: e.target.value } : x)),
                      )
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
            {pending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Send className="h-3.5 w-3.5" />
            )}
            Create Template
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
