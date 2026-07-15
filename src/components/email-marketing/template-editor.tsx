'use client'

// @deprecated Legacy /email-marketing system, retired in favor of the
// block-based builder at /settings/email-templates. Dead code — unreachable
// now that every /email-marketing route redirects. Retained deliberately
// during the deprecation window; scheduled for deletion once production
// data confirms no org used the legacy system. Do not build new features
// against this. See
// .planning/workstreams/email-builder-hardening/PLAN.md Phase 5.

import { useState, useTransition, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import {
  ChevronUp, ChevronDown, Trash2, Plus, Save, Sparkles,
  Loader2, Eye, GripVertical, RefreshCw,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from '@/components/ui/sheet'
import { EmailPreview } from './email-preview'
import { renderEmailHtml } from '@/lib/email-marketing/render'
import {
  updateEmailTemplate,
  upsertTemplateSection,
  deleteTemplateSection,
  reorderTemplateSections,
} from '@/app/(dashboard)/email-marketing/_actions/templates'
import { regenerateSection } from '@/app/(dashboard)/email-marketing/_actions/generate'
import type {
  EmailTemplateRow,
  EmailTemplateSectionRow,
  TemplateWithSections,
} from '@/app/(dashboard)/email-marketing/_actions/templates'
import { cn } from '@/lib/utils'

const SECTION_TYPES = ['header', 'hero', 'cta', 'text', 'image', 'divider', 'social', 'footer', 'custom'] as const

interface TemplateEditorProps {
  template: TemplateWithSections
}

export function TemplateEditor({ template: initial }: TemplateEditorProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  // Meta state
  const [name, setName] = useState(initial.name)
  const [subjectLine, setSubjectLine] = useState(initial.subject_line)
  const [previewText, setPreviewText] = useState(initial.preview_text)
  const [status, setStatus] = useState(initial.status)

  // Sections state
  const [sections, setSections] = useState<EmailTemplateSectionRow[]>(initial.sections)
  const [activeSection, setActiveSection] = useState<string | null>(null)

  // Preview sheet
  const [previewOpen, setPreviewOpen] = useState(false)

  // AI regen
  const [regenPrompt, setRegenPrompt] = useState('')
  const [regenTarget, setRegenTarget] = useState<string | null>(null)

  const assembledHtml = renderEmailHtml(
    { subject_line: subjectLine, preview_text: previewText, name },
    sections,
  )

  // ── Save meta ───────────────────────────────────────────────────────────────
  function saveMeta() {
    startTransition(async () => {
      const result = await updateEmailTemplate(initial.id, {
        name, subject_line: subjectLine, preview_text: previewText,
        status: status as 'draft' | 'ready' | 'archived',
      })
      if (!result.ok) toast.error(result.error)
      else toast.success('Salvo')
    })
  }

  // ── Section HTML edit ───────────────────────────────────────────────────────
  function updateSectionHtml(id: string, html: string) {
    setSections((prev) => prev.map((s) => (s.id === id ? { ...s, html_content: html } : s)))
  }

  function saveSectionHtml(section: EmailTemplateSectionRow) {
    startTransition(async () => {
      const result = await upsertTemplateSection(initial.id, {
        id: section.id, name: section.name, type: section.type,
        html_content: section.html_content, sort_order: section.sort_order,
      })
      if (!result.ok) toast.error(result.error)
      else toast.success('Seção salva')
    })
  }

  // ── Reorder ─────────────────────────────────────────────────────────────────
  function moveSection(id: string, dir: 'up' | 'down') {
    setSections((prev) => {
      const idx = prev.findIndex((s) => s.id === id)
      if (dir === 'up' && idx === 0) return prev
      if (dir === 'down' && idx === prev.length - 1) return prev

      const next = [...prev]
      const swap = dir === 'up' ? idx - 1 : idx + 1;
      [next[idx], next[swap]] = [next[swap], next[idx]]

      const updated = next.map((s, i) => ({ ...s, sort_order: i }))

      // Persist async
      void reorderTemplateSections(updated.map((s) => ({ id: s.id, sort_order: s.sort_order })))
      return updated
    })
  }

  // ── Delete section ──────────────────────────────────────────────────────────
  function removeSection(id: string) {
    startTransition(async () => {
      const result = await deleteTemplateSection(id)
      if (!result.ok) { toast.error(result.error); return }
      setSections((prev) => prev.filter((s) => s.id !== id).map((s, i) => ({ ...s, sort_order: i })))
    })
  }

  // ── Add blank section ───────────────────────────────────────────────────────
  function addSection() {
    startTransition(async () => {
      const result = await upsertTemplateSection(initial.id, {
        name: 'Nova seção', type: 'text', html_content: '<table width="100%"><tr><td style="padding:24px;font-family:sans-serif;font-size:15px;line-height:1.6;color:#333;">Edite o conteúdo desta seção.</td></tr></table>',
        sort_order: sections.length,
      })
      if (!result.ok) { toast.error(result.error); return }
      setSections((prev) => [...prev, result.data])
      setActiveSection(result.data.id)
    })
  }

  // ── AI regen section ────────────────────────────────────────────────────────
  function handleRegen(sectionId: string) {
    if (!regenPrompt.trim()) return
    startTransition(async () => {
      const result = await regenerateSection({
        sectionId, templateId: initial.id, prompt: regenPrompt,
      })
      if (!result.ok) { toast.error(result.error); return }
      setSections((prev) =>
        prev.map((s) => s.id === sectionId ? { ...s, html_content: result.data.html_content } : s),
      )
      setRegenTarget(null)
      setRegenPrompt('')
      toast.success('Seção regenerada')
    })
  }

  return (
    <div className="flex flex-col gap-6">
      {/* ── Meta bar ─────────────────────────────────────────────────────────── */}
      <div className="rounded-lg border border-border bg-card p-4 space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label className="text-xs">Nome do template</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Status</Label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="draft">Rascunho</SelectItem>
                <SelectItem value="ready">Pronto</SelectItem>
                <SelectItem value="archived">Arquivado</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1 sm:col-span-2">
            <Label className="text-xs">Assunto (subject line)</Label>
            <Input
              value={subjectLine}
              onChange={(e) => setSubjectLine(e.target.value)}
              placeholder="ex: Novidade no Xphere que você vai adorar 🚀"
            />
          </div>
          <div className="space-y-1 sm:col-span-2">
            <Label className="text-xs">Preview text <span className="text-muted-foreground">(snippet no inbox)</span></Label>
            <Input
              value={previewText}
              onChange={(e) => setPreviewText(e.target.value)}
              maxLength={300}
              placeholder="Texto curto exibido como snippet pelos clientes de email…"
            />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={saveMeta} disabled={isPending} className="gap-1.5">
            {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
            Salvar
          </Button>
          <Button size="sm" variant="outline" onClick={() => setPreviewOpen(true)} className="gap-1.5">
            <Eye className="h-3.5 w-3.5" /> Preview
          </Button>
        </div>
      </div>

      {/* ── Sections list ─────────────────────────────────────────────────────── */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium">Seções <span className="text-muted-foreground">({sections.length})</span></h2>
          <Button size="sm" variant="outline" onClick={addSection} disabled={isPending} className="gap-1.5">
            <Plus className="h-3.5 w-3.5" /> Add section
          </Button>
        </div>

        {sections.length === 0 && (
          <div className="rounded-lg border border-dashed border-border py-10 text-center text-sm text-muted-foreground">
            No sections yet. Click "Add section" to get started.
          </div>
        )}

        {sections.map((section, idx) => (
          <SectionPanel
            key={section.id}
            section={section}
            idx={idx}
            total={sections.length}
            isActive={activeSection === section.id}
            onToggle={() => setActiveSection(activeSection === section.id ? null : section.id)}
            onHtmlChange={(html) => updateSectionHtml(section.id, html)}
            onSave={() => saveSectionHtml(section)}
            onMoveUp={() => moveSection(section.id, 'up')}
            onMoveDown={() => moveSection(section.id, 'down')}
            onDelete={() => removeSection(section.id)}
            onRegen={() => setRegenTarget(section.id)}
            isPending={isPending}
          />
        ))}
      </div>

      {/* ── AI regen sheet ───────────────────────────────────────────────────── */}
      <Sheet open={!!regenTarget} onOpenChange={(o) => { if (!o) { setRegenTarget(null); setRegenPrompt('') } }}>
        <SheetContent side="right" className="w-full sm:max-w-md">
          <SheetHeader className="mb-4">
            <SheetTitle>Regenerar seção com IA</SheetTitle>
          </SheetHeader>
          <div className="space-y-4">
            <Textarea
              placeholder="Descreva o que você quer nessa seção…"
              value={regenPrompt}
              onChange={(e) => setRegenPrompt(e.target.value)}
              rows={5}
              className="resize-none"
            />
            <Button
              className="w-full gap-2"
              disabled={!regenPrompt.trim() || isPending}
              onClick={() => regenTarget && handleRegen(regenTarget)}
            >
              {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              Regenerar
            </Button>
          </div>
        </SheetContent>
      </Sheet>

      {/* ── Full preview sheet ───────────────────────────────────────────────── */}
      <Sheet open={previewOpen} onOpenChange={setPreviewOpen}>
        <SheetContent side="right" className="w-full sm:max-w-4xl p-0 flex flex-col">
          <div className="px-6 py-4 border-b border-border shrink-0">
            <h2 className="text-sm font-medium">Preview | {name}</h2>
          </div>
          <div className="flex-1 overflow-hidden">
            <EmailPreview
              html={assembledHtml}
              subjectLine={subjectLine}
              previewText={previewText}
            />
          </div>
        </SheetContent>
      </Sheet>
    </div>
  )
}

// ─── Section panel ─────────────────────────────────────────────────────────────

interface SectionPanelProps {
  section: EmailTemplateSectionRow
  idx: number
  total: number
  isActive: boolean
  onToggle: () => void
  onHtmlChange: (html: string) => void
  onSave: () => void
  onMoveUp: () => void
  onMoveDown: () => void
  onDelete: () => void
  onRegen: () => void
  isPending: boolean
}

function SectionPanel({
  section, idx, total, isActive, onToggle, onHtmlChange,
  onSave, onMoveUp, onMoveDown, onDelete, onRegen, isPending,
}: SectionPanelProps) {
  const [localHtml, setLocalHtml] = useState(section.html_content)

  return (
    <div className={cn('rounded-lg border transition-colors', isActive ? 'border-primary/40 bg-card' : 'border-border bg-card/50')}>
      {/* Header row */}
      <div
        className="flex items-center gap-2 px-3 py-2.5 cursor-pointer select-none"
        onClick={onToggle}
      >
        <GripVertical className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <span className="text-xs text-muted-foreground tabular-nums w-4 shrink-0">{idx + 1}</span>
        <Badge variant="outline" className="text-[10px] capitalize shrink-0">{section.type}</Badge>
        <span className="text-sm font-medium flex-1 min-w-0 truncate">{section.name}</span>
        <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
          <Button size="icon" variant="ghost" className="h-6 w-6" onClick={onMoveUp} disabled={idx === 0 || isPending} title="Mover para cima">
            <ChevronUp className="h-3 w-3" />
          </Button>
          <Button size="icon" variant="ghost" className="h-6 w-6" onClick={onMoveDown} disabled={idx === total - 1 || isPending} title="Mover para baixo">
            <ChevronDown className="h-3 w-3" />
          </Button>
          <Button size="icon" variant="ghost" className="h-6 w-6" onClick={onRegen} title="Regenerar com IA">
            <Sparkles className="h-3 w-3" />
          </Button>
          <Button size="icon" variant="ghost" className="h-6 w-6 text-destructive hover:text-destructive" onClick={onDelete} disabled={isPending} title="Deletar seção">
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
      </div>

      {/* Expanded editor */}
      {isActive && (
        <div className="px-3 pb-3 space-y-2 border-t border-border">
          <Textarea
            value={localHtml}
            onChange={(e) => {
              setLocalHtml(e.target.value)
              onHtmlChange(e.target.value)
            }}
            className="font-mono text-xs resize-none"
            rows={12}
            spellCheck={false}
          />
          <Button size="sm" onClick={() => { onHtmlChange(localHtml); onSave() }} disabled={isPending} className="gap-1.5">
            {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
            Salvar seção
          </Button>
        </div>
      )}
    </div>
  )
}
