'use client'

// "Send WhatsApp" bulk action for /prospects. Resolves whichever WhatsApp
// rail is active for the org (Meta Cloud > Zernio > Evolution/Z-API/W-API)
// and dispatches immediately — this is NOT a campaign, it's a direct send
// mirroring startOutreach()/sendToXpot().
//
// Design decisions (see the PR report for detail):
//  - MARKETING-category templates are opt-in-gated for CONTACT prospects
//    (contacts.whatsapp_opt_in); UTILITY/AUTHENTICATION and the Evolution
//    free-text rail are not. Company prospects have no opt-in column and are
//    never gated.
//  - DND is checked per contact (accounts have no DND).
//  - Hard cap of 200 recipients per invocation; the remainder is reported so
//    the operator can run the action again.

import * as React from 'react'
import { MessageCircle, TriangleAlert } from 'lucide-react'
import { toast } from 'sonner'

import {
  listProspectWhatsAppTemplates,
  sendWhatsAppToProspects,
  type ProspectRef,
  type ProspectRow,
  type ProspectWhatsAppProvider,
  type ProspectWhatsAppTemplate,
} from '@/app/(dashboard)/prospects/actions'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

function highlightVars(text: string): React.ReactNode {
  const parts = text.split(/(\{\{\d+\}\})/)
  return parts.map((part, i) =>
    /^\{\{\d+\}\}$/.test(part) ? (
      <span key={i} className="rounded bg-accent/15 px-1 font-mono text-[11.5px] text-accent">
        {part}
      </span>
    ) : (
      <span key={i}>{part}</span>
    ),
  )
}

interface WhatsAppBulkDialogProps {
  selectedRefs: ProspectRef[]
  selectedRows: ProspectRow[]
  disabled?: boolean
  onDone: () => void
}

export function WhatsAppBulkDialog({ selectedRefs, selectedRows, disabled, onDone }: WhatsAppBulkDialogProps) {
  const [open, setOpen] = React.useState(false)
  const [loading, setLoading] = React.useState(false)
  const [provider, setProvider] = React.useState<ProspectWhatsAppProvider>('none')
  const [templates, setTemplates] = React.useState<ProspectWhatsAppTemplate[]>([])
  const [templateId, setTemplateId] = React.useState('')
  const [variables, setVariables] = React.useState<string[]>([])
  const [freeText, setFreeText] = React.useState('')
  const [submitting, setSubmitting] = React.useState(false)

  const withPhone = React.useMemo(() => selectedRows.filter((r) => Boolean(r.phone)).length, [selectedRows])
  const withoutPhone = selectedRows.length - withPhone

  const selectedTemplate = templates.find((t) => t.id === templateId) ?? null
  const isTemplated = provider === 'meta_cloud' || provider === 'zernio'

  React.useEffect(() => {
    if (!open) return
    setLoading(true)
    setTemplateId('')
    setVariables([])
    setFreeText('')
    let cancelled = false

    void (async () => {
      try {
        const res = await listProspectWhatsAppTemplates()
        if (cancelled) return
        if (!res.ok) {
          toast.error(res.error)
          setProvider('none')
          setTemplates([])
          return
        }
        setProvider(res.provider)
        setTemplates(res.templates)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [open])

  function selectTemplate(id: string) {
    setTemplateId(id)
    const tpl = templates.find((t) => t.id === id)
    setVariables(tpl ? new Array(tpl.bodyVariableCount).fill('') : [])
  }

  const canSubmit =
    !submitting &&
    withPhone > 0 &&
    (isTemplated
      ? Boolean(templateId) && (selectedTemplate ? variables.length === selectedTemplate.bodyVariableCount && variables.every(Boolean) : false)
      : freeText.trim().length > 0)

  async function submit() {
    setSubmitting(true)
    const res = await sendWhatsAppToProspects(selectedRefs, {
      templateId: isTemplated ? templateId : null,
      bodyVariables: isTemplated ? variables : undefined,
      freeText: isTemplated ? null : freeText,
    })
    setSubmitting(false)
    if (!res.ok) {
      toast.error(res.error)
      return
    }
    const parts = [`${res.sent} enviada${res.sent === 1 ? '' : 's'}`]
    if (res.failed > 0) parts.push(`${res.failed} falharam`)
    if (res.skippedDnd > 0) parts.push(`${res.skippedDnd} bloqueados (DND)`)
    if (res.skippedOptIn > 0) parts.push(`${res.skippedOptIn} sem opt-in`)
    if (res.skippedNoPhone > 0) parts.push(`${res.skippedNoPhone} sem telefone`)
    if (res.skippedDuplicate > 0) parts.push(`${res.skippedDuplicate} duplicados`)
    if (res.remaining > 0) parts.push(`${res.remaining} não processados (limite de 200 — rode novamente)`)
    toast.success(parts.join(' · '))
    setOpen(false)
    onDone()
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="ghost" className="h-7" disabled={disabled}>
          <MessageCircle className="h-3.5 w-3.5" />
          Send WhatsApp
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-[560px]">
        <DialogHeader>
          <DialogTitle>Send WhatsApp</DialogTitle>
          <DialogDescription>
            Sends immediately to the selected prospects who have a phone number — this is not a scheduled campaign.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-[8px] border border-border-subtle bg-bg-tertiary/40 px-3 py-2 text-[12.5px] text-text-secondary">
            <strong className="text-text-primary">{withPhone}</strong> of {selectedRows.length} selected prospects
            have a phone number.
            {withoutPhone > 0 ? ` ${withoutPhone} will be skipped.` : ''}
            {withPhone > 200 ? ` Only the first 200 will be processed this run.` : ''}
          </div>

          {loading ? (
            <p className="text-[13px] text-text-tertiary">Checking your WhatsApp connection…</p>
          ) : provider === 'none' ? (
            <div className="rounded-[8px] border border-border bg-bg-tertiary/50 p-4 text-center text-[13px] text-text-secondary">
              No WhatsApp channel is connected. Connect WhatsApp Official, Zernio, or Evolution in Integrations.
            </div>
          ) : isTemplated ? (
            <>
              <div className="space-y-1.5">
                <Label className="text-[12px]">
                  Approved template ({provider === 'meta_cloud' ? 'WhatsApp Official' : 'Zernio'})
                </Label>
                {templates.length === 0 ? (
                  <div className="rounded-[8px] border border-border bg-bg-tertiary/50 p-3 text-[12.5px] text-text-secondary">
                    No APPROVED templates yet. Create one in Settings → WhatsApp Templates first — cold outreach
                    outside the 24h window requires an approved template.
                  </div>
                ) : (
                  <Select value={templateId} onValueChange={selectTemplate}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select a template" />
                    </SelectTrigger>
                    <SelectContent>
                      {templates.map((t) => (
                        <SelectItem key={t.id} value={t.id} disabled={t.headerVariableCount > 0}>
                          {t.name} ({t.language}) — {t.category}
                          {t.headerVariableCount > 0 ? ' — has header variables, unsupported' : ''}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>

              {selectedTemplate && (
                <>
                  {selectedTemplate.bodyText && (
                    <div className="rounded-[8px] border border-border-subtle bg-bg-tertiary/40 p-3">
                      <p className="mb-1.5 text-[11px] uppercase tracking-wide text-text-tertiary">Preview</p>
                      <p className="whitespace-pre-wrap text-[12.5px] leading-relaxed text-text-secondary">
                        {highlightVars(selectedTemplate.bodyText)}
                      </p>
                    </div>
                  )}

                  {selectedTemplate.category === 'MARKETING' && (
                    <div className="rounded-[8px] border border-amber-500/40 bg-amber-500/10 p-3">
                      <p className="text-[11.5px] text-amber-200">
                        <strong>Marketing template.</strong> Only contact prospects who opted in to WhatsApp will
                        receive it — others are counted as skipped. Company prospects are never gated (no opt-in
                        tracking exists for accounts).
                      </p>
                    </div>
                  )}

                  {selectedTemplate.bodyVariableCount > 0 && (
                    <div className="space-y-2">
                      <Label className="text-[12px]">
                        Body variables — use the literal token <code>{'{{name}}'}</code> to insert each prospect&apos;s
                        name
                      </Label>
                      {variables.map((value, idx) => (
                        <div key={idx} className="flex items-center gap-2">
                          <span className="w-12 shrink-0 font-mono text-[11px] text-text-tertiary">
                            {'{{' + (idx + 1) + '}}'}
                          </span>
                          <Input
                            value={value}
                            onChange={(e) => {
                              const next = [...variables]
                              next[idx] = e.target.value
                              setVariables(next)
                            }}
                            placeholder="Static value or {{name}}"
                            className="flex-1 text-[12.5px]"
                          />
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </>
          ) : (
            <>
              <div className="flex items-start gap-2 rounded-[8px] border border-red-500/40 bg-red-500/10 p-3">
                <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
                <p className="text-[11.5px] text-red-200">
                  This org&apos;s WhatsApp channel is an unofficial provider (Evolution/Z-API/W-API) with no template
                  guardrails. Sending free-text cold outreach at volume risks the number being banned by WhatsApp.
                  Proceed only if you understand the risk.
                </p>
              </div>
              <div className="space-y-1.5">
                <Label className="text-[12px]">
                  Message — use the literal token <code>{'{{name}}'}</code> to insert each prospect&apos;s name
                </Label>
                <Textarea
                  value={freeText}
                  onChange={(e) => setFreeText(e.target.value)}
                  placeholder="Hi {{name}}, ..."
                  rows={4}
                />
              </div>
            </>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button type="button" disabled={!canSubmit} onClick={submit}>
            {submitting ? 'Sending…' : 'Send'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
