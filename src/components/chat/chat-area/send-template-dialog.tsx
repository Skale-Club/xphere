'use client'

/**
 * SendTemplateDialog — modal for picking + filling a WhatsApp Cloud
 * approved template, then sending it on the current conversation.
 *
 * Differs from the campaign wizard's variable mapping: here the operator
 * types literal values for each {{n}} because the context is a single
 * conversation (no mapping to dynamic contact fields needed).
 */

import { useEffect, useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Loader2, Plus, Send } from 'lucide-react'
import { TemplateComposerDialog } from '@/components/integrations/whatsapp/template-composer-dialog'

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
import { Badge } from '@/components/ui/badge'
import {
  listApprovedTemplates,
  type ApprovedTemplate,
} from '@/app/(dashboard)/integrations/whatsapp/actions'

interface SendTemplateDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  conversationId: string
  onSent?: () => void
}

export function SendTemplateDialog({
  open,
  onOpenChange,
  conversationId,
  onSent,
}: SendTemplateDialogProps) {
  const [templates, setTemplates] = useState<ApprovedTemplate[]>([])
  const [loading, setLoading] = useState(false)
  const [selectedId, setSelectedId] = useState('')
  const [bodyValues, setBodyValues] = useState<string[]>([])
  const [headerValues, setHeaderValues] = useState<string[]>([])
  const [composerOpen, setComposerOpen] = useState(false)
  const [pending, startTransition] = useTransition()

  function reloadTemplates() {
    setLoading(true)
    listApprovedTemplates()
      .then((data) => setTemplates(data))
      .catch(() => setTemplates([]))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    if (!open) return
    setLoading(true)
    listApprovedTemplates()
      .then((data) => setTemplates(data))
      .catch(() => setTemplates([]))
      .finally(() => setLoading(false))
  }, [open])

  // Reset state when dialog closes
  useEffect(() => {
    if (!open) {
      setSelectedId('')
      setBodyValues([])
      setHeaderValues([])
    }
  }, [open])

  const selected = templates.find((t) => t.id === selectedId) ?? null

  function handleSelect(id: string) {
    setSelectedId(id)
    const tpl = templates.find((t) => t.id === id)
    setBodyValues(tpl ? new Array(tpl.bodyVariableCount).fill('') : [])
    setHeaderValues(tpl ? new Array(tpl.headerVariableCount).fill('') : [])
  }

  const canSend =
    !!selected &&
    bodyValues.length === selected.bodyVariableCount &&
    headerValues.length === selected.headerVariableCount &&
    bodyValues.every((v) => v.trim()) &&
    headerValues.every((v) => v.trim())

  async function handleSend() {
    if (!selected || !canSend) return
    startTransition(async () => {
      try {
        const res = await fetch(
          `/api/chat/conversations/${conversationId}/send-template`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              templateId: selected.id,
              bodyVariables: bodyValues,
              headerVariables: headerValues,
            }),
          },
        )
        const data = (await res.json()) as { ok?: boolean; error?: string; wamid?: string }
        if (!res.ok || !data.ok) {
          toast.error(data.error ?? 'Failed to send template')
          return
        }
        toast.success('Template sent')
        onSent?.()
        onOpenChange(false)
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Network error')
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Send WhatsApp template</DialogTitle>
          <DialogDescription>
            Pick an approved template and fill in the variables.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {loading ? (
            <div className="flex items-center justify-center py-8 text-text-tertiary">
              <Loader2 className="h-4 w-4 animate-spin" />
            </div>
          ) : templates.length === 0 ? (
            <div className="rounded-[8px] border border-border bg-bg-tertiary/40 p-4 text-[12.5px] text-text-secondary">
              No approved templates yet. Create one in Meta Business Manager, then go to
              Integrations → WhatsApp Official and click <strong>Sync from Meta</strong>.
            </div>
          ) : (
            <>
              <div className="space-y-1.5">
                <Label className="text-[12px]">Template</Label>
                <select
                  value={selectedId}
                  onChange={(e) => handleSelect(e.target.value)}
                  className="w-full h-9 px-3 rounded-[8px] border border-border bg-bg-secondary text-[13px] text-text-primary"
                >
                  <option value="">— Select —</option>
                  {templates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name} ({t.language}) — {t.category}
                    </option>
                  ))}
                </select>
              </div>

              {selected && (
                <>
                  {selected.bodyText && (
                    <div className="rounded-[8px] border border-border-subtle bg-bg-tertiary/40 p-3">
                      <p className="text-[11px] uppercase tracking-wide text-text-tertiary mb-1.5">
                        Preview
                      </p>
                      <p className="text-[12.5px] text-text-secondary whitespace-pre-wrap leading-relaxed">
                        {highlightVars(selected.bodyText)}
                      </p>
                    </div>
                  )}

                  {selected.category === 'MARKETING' && (
                    <div className="rounded-[8px] border border-amber-500/40 bg-amber-500/10 p-2.5 text-[11.5px] text-amber-200">
                      <strong>Marketing template.</strong> Only deliverable to contacts who have
                      opted in to WhatsApp.
                    </div>
                  )}

                  {selected.headerVariableCount > 0 && (
                    <VariableInputGroup
                      label="Header variables"
                      count={selected.headerVariableCount}
                      values={headerValues}
                      onChange={setHeaderValues}
                    />
                  )}

                  {selected.bodyVariableCount > 0 && (
                    <VariableInputGroup
                      label="Body variables"
                      count={selected.bodyVariableCount}
                      values={bodyValues}
                      onChange={setBodyValues}
                    />
                  )}

                  {selected.bodyVariableCount === 0 &&
                    selected.headerVariableCount === 0 && (
                      <p className="text-[12.5px] text-text-tertiary">
                        This template has no variables.
                      </p>
                    )}

                  <div className="flex items-center gap-2 ml-auto justify-end mt-1">
                    <Badge variant="outline" className="text-[10px]">
                      {selected.language}
                    </Badge>
                    <Badge variant="outline" className="text-[10px]">
                      {selected.category}
                    </Badge>
                  </div>
                </>
              )}
            </>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 pt-2 border-t border-border">
          <Button
            variant="ghost"
            onClick={() => setComposerOpen(true)}
            disabled={pending}
            className="gap-1.5 text-[12.5px] text-accent"
          >
            <Plus className="h-3.5 w-3.5" />
            Create new template
          </Button>
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={pending}>
              Cancel
            </Button>
            <Button onClick={handleSend} disabled={!canSend || pending} className="gap-1.5">
              {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
              Send
            </Button>
          </div>
        </div>
      </DialogContent>

      {/* New template lands as PENDING — reload the approved list once Meta approves + sync. */}
      <TemplateComposerDialog
        open={composerOpen}
        onOpenChange={setComposerOpen}
        onCreated={reloadTemplates}
      />
    </Dialog>
  )
}

function VariableInputGroup({
  label,
  count,
  values,
  onChange,
}: {
  label: string
  count: number
  values: string[]
  onChange: (next: string[]) => void
}) {
  const safe = values.length === count ? values : new Array(count).fill('')
  return (
    <div className="space-y-2">
      <Label className="text-[12px]">{label}</Label>
      {Array.from({ length: count }).map((_, idx) => (
        <div key={idx} className="flex items-center gap-2">
          <span className="text-[11px] font-mono text-text-tertiary w-12 shrink-0">
            {'{{' + (idx + 1) + '}}'}
          </span>
          <Input
            value={safe[idx] ?? ''}
            onChange={(e) => {
              const next = [...safe]
              next[idx] = e.target.value
              onChange(next)
            }}
            placeholder="Value"
            className="flex-1 h-9 text-[12.5px]"
          />
        </div>
      ))}
    </div>
  )
}

function highlightVars(text: string): React.ReactNode {
  const parts = text.split(/(\{\{\d+\}\})/)
  return parts.map((part, i) =>
    /^\{\{\d+\}\}$/.test(part) ? (
      <span
        key={i}
        className="px-1 rounded bg-accent/15 text-accent font-mono text-[11.5px]"
      >
        {part}
      </span>
    ) : (
      <span key={i}>{part}</span>
    ),
  )
}
