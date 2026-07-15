'use client'

import { useState, useTransition, useCallback, useEffect, useMemo, useRef } from 'react'
import { toast } from 'sonner'
import {
  Save, Eye, Loader2, Send, Undo2, Redo2, Trash2,
  Smartphone, Monitor, Circle, Layers, Check, TestTube2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog'
import { useBreadcrumbOverride } from '@/components/layout/breadcrumb-override-context'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'

import {
  DndContext, KeyboardSensor, PointerSensor,
  useSensor, useSensors, DragEndEvent, DragStartEvent, DragOverEvent,
  DragOverlay, closestCorners,
} from '@dnd-kit/core'
import { sortableKeyboardCoordinates, arrayMove } from '@dnd-kit/sortable'

import type {
  EmailDocument, EmailSection, EmailBlock, EmailBlockType,
} from '@/lib/email/render-template'
import {
  renderTemplate, BLOCK_DEFAULTS, makeBlockId, normalizeDocument, normalizeSectionTemplateDoc,
} from '@/lib/email/render-template'
import { renderWithVariables } from '@/lib/email/merge-tags'
import { findBlockLocation, insertBlockInColumn, moveBlock } from '@/lib/email/editor-dnd'
import {
  saveTemplate, saveSectionTemplate, deleteSectionTemplate, publishTemplate, unpublishTemplate,
  sendTestEmail,
} from '../actions'
import type { EmailTemplateBuilderRow, SectionTemplate } from '../actions'
import { BlockPalette } from './block-palette'
import { Canvas } from './editor/canvas'
import { InspectorPanel } from './editor/inspector-panel'
import { EditorContext, type EditorApi } from './editor/context'
import { useEditorHistory } from './editor/use-editor-history'

type SaveResult = { ok: true } | { ok: false; error?: string }

// Sample values for the preview dialog's "Sample data" toggle — mirrors the
// canonical tag list in merge-tag-picker.tsx's MERGE_TAGS (kept in sync by
// hand; both are small, static lists).
const SAMPLE_VARS = {
  contact: {
    first_name: 'Ana',
    last_name: 'Silva',
    name: 'Ana Silva',
    email: 'ana@example.com',
    phone: '+1 555-0142',
    company: 'Acme Co',
  },
  org: { name: 'Your Company' },
}

// Debounce window between the last doc/subject/preview edit and the silent
// autosave (Phase 6). Long enough to not fire on every keystroke, short
// enough that a stray tab close loses at most a few seconds of work.
const AUTOSAVE_DELAY_MS = 2500

/** Category tags for a section template — advisory only (no DB constraint). */
const SECTION_TYPES = ['header', 'footer', 'cta', 'logo', 'social', 'legal', 'custom']

interface EmailTemplateEditorProps {
  template: EmailTemplateBuilderRow
  sectionTemplates: SectionTemplate[]
  /** 'section' constrains the editor to a single section template:
   *  hides publish/add-section/section chrome and saves via
   *  onSaveDocument instead of the template save action. */
  variant?: 'template' | 'section'
  /** Section-mode save: receives the working document + name; the caller maps it
   *  back to an email_section_templates row. */
  onSaveDocument?: (doc: EmailDocument, name: string) => Promise<SaveResult>
  /** Section-mode only: current section_type + change handler for the inline
   *  type selector rendered in the toolbar. */
  sectionType?: string
  onSectionTypeChange?: (value: string) => void
}

function makeSection(layout: 1 | 2 | 3 = 1): EmailSection {
  return {
    id: makeBlockId(),
    layout,
    backgroundColor: '#ffffff',
    padding: { top: 16, right: 24, bottom: 16, left: 24 },
    columns: Array.from({ length: layout }, () => []),
  }
}

function cloneBlock(b: EmailBlock): EmailBlock {
  return { ...b, id: makeBlockId() }
}

export function EmailTemplateEditor({
  template, sectionTemplates: initialSectionTemplates, variant = 'template', onSaveDocument,
  sectionType, onSectionTypeChange,
}: EmailTemplateEditorProps) {
  const initialDoc = useMemo(() => normalizeDocument(template.document), [template.document])
  const { state: doc, set: setDoc, undo, redo, canUndo, canRedo } = useEditorHistory<EmailDocument>(initialDoc)

  const [name, setName] = useState(template.name)
  const [status, setStatus] = useState(template.status)
  // Subject/preview text — persisted in the `email_templates.subject_line` /
  // `preview_text` columns (not the document jsonb; see actions.ts). Not
  // applicable to variant='section' (a section template has no subject), but
  // kept as real state either way so EditorApi has a uniform shape.
  const [subjectLine, setSubjectLine] = useState(template.subject_line ?? '')
  const [previewText, setPreviewText] = useState(template.preview_text ?? '')
  const [isPending, startTransition] = useTransition()
  const [sectionTemplates, setSectionTemplates] = useState<SectionTemplate[]>(initialSectionTemplates)
  const [selectedSectionId, setSelectedSectionId] = useState<string | null>(null)
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null)

  const snapshotOf = useCallback(
    (d: EmailDocument, subject: string, preview: string) => JSON.stringify({ doc: d, subjectLine: subject, previewText: preview }),
    [],
  )
  const [savedSnapshot, setSavedSnapshot] = useState(() => snapshotOf(initialDoc, subjectLine, previewText))
  const isDirty = useMemo(
    () => snapshotOf(doc, subjectLine, previewText) !== savedSnapshot,
    [doc, subjectLine, previewText, savedSnapshot, snapshotOf],
  )

  // Warn before closing/reloading the tab with unsaved changes. Autosave
  // (below) narrows the exposure window to a few seconds, but doesn't
  // eliminate it (e.g. a save in flight, or a very fast close).
  useEffect(() => {
    if (!isDirty) return
    function handleBeforeUnload(e: BeforeUnloadEvent) {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [isDirty])

  // Live refs so save/preview always read the freshest committed doc/name/
  // subject/preview even when triggered from a keyboard shortcut (or the
  // autosave timer) in the same tick as a blur commit. Synced in an effect
  // (never during render) so ref reads in event handlers / rAF callbacks /
  // timers always see the last committed value.
  const docRef = useRef(doc)
  const nameRef = useRef(name)
  const subjectRef = useRef(subjectLine)
  const previewRef = useRef(previewText)
  useEffect(() => {
    docRef.current = doc
    nameRef.current = name
    subjectRef.current = subjectLine
    previewRef.current = previewText
  })

  /** Commit any focused inline (contentEditable) edit, then run `cb` with the
   *  freshest document. When a text/heading block is being edited its content
   *  only lands in state on blur, so we blur first and defer a frame so the
   *  onBlur state update has flushed into `docRef`. */
  const runWithFreshDoc = useCallback((cb: (d: EmailDocument) => void) => {
    const el = document.activeElement as HTMLElement | null
    if (el && el.isContentEditable) {
      el.blur()
      requestAnimationFrame(() => cb(docRef.current))
    } else {
      cb(docRef.current)
    }
  }, [])

  // ── Selection ────────────────────────────────────────────────────────────────
  const selectBlock = useCallback((id: string | null) => setSelectedBlockId(id), [])
  const selectSection = useCallback((id: string | null) => {
    setSelectedSectionId(id)
    if (id) setSelectedBlockId(null)
  }, [])

  // ── Section mutations ──────────────────────────────────────────────────────────
  const addSection = useCallback((layout: 1 | 2 | 3 = 1) => {
    const section = makeSection(layout)
    setDoc((prev) => ({ ...prev, sections: [...prev.sections, section] }))
    setSelectedSectionId(section.id)
    setSelectedBlockId(null)
  }, [setDoc])

  const removeSection = useCallback((sectionId: string) => {
    setDoc((prev) => ({ ...prev, sections: prev.sections.filter((s) => s.id !== sectionId) }))
    setSelectedSectionId((cur) => (cur === sectionId ? null : cur))
  }, [setDoc])

  const duplicateSection = useCallback((sectionId: string) => {
    setDoc((prev) => {
      const idx = prev.sections.findIndex((s) => s.id === sectionId)
      if (idx === -1) return prev
      const s = prev.sections[idx]
      const clone: EmailSection = {
        ...s,
        id: makeBlockId(),
        columns: s.columns.map((col) => col.map(cloneBlock)),
      }
      const next = prev.sections.slice()
      next.splice(idx + 1, 0, clone)
      return { ...prev, sections: next }
    })
  }, [setDoc])

  const updateSection = useCallback((sectionId: string, updates: Partial<EmailSection>) => {
    setDoc((prev) => ({
      ...prev,
      sections: prev.sections.map((s) => (s.id === sectionId ? { ...s, ...updates } : s)),
    }))
  }, [setDoc])

  const moveSection = useCallback((sectionId: string, dir: -1 | 1) => {
    setDoc((prev) => {
      const idx = prev.sections.findIndex((s) => s.id === sectionId)
      const target = idx + dir
      if (idx === -1 || target < 0 || target >= prev.sections.length) return prev
      return { ...prev, sections: arrayMove(prev.sections, idx, target) }
    })
  }, [setDoc])

  // ── Block mutations ──────────────────────────────────────────────────────────────
  // (Blocks are added by dragging a chip from the palette onto the canvas —
  // there is no programmatic/menu-driven "add block" affordance; a prior
  // `addBlock` callback here was dead code and was removed, Phase 3 cleanup.)

  /** Inserts a saved section template as a NEW section (fresh section + block
   *  ids), positioned after `afterSectionId` — or at the document end when
   *  null/not found. Section templates store a full `EmailSection` (Phase 3;
   *  upgrade-on-read handles legacy `{ blocks }` rows), so this clones the
   *  whole section rather than splicing blocks into an existing column. */
  const insertSectionTemplate = useCallback((afterSectionId: string | null, st: SectionTemplate) => {
    const { section } = normalizeSectionTemplateDoc(st.document)
    const cloned: EmailSection = {
      ...section,
      id: makeBlockId(),
      columns: section.columns.map((col) => col.map(cloneBlock)),
    }
    setDoc((prev) => {
      const idx = afterSectionId ? prev.sections.findIndex((s) => s.id === afterSectionId) : -1
      const insertAt = idx === -1 ? prev.sections.length : idx + 1
      const next = prev.sections.slice()
      next.splice(insertAt, 0, cloned)
      return { ...prev, sections: next }
    })
    setSelectedBlockId(null)
    setSelectedSectionId(cloned.id)
  }, [setDoc])

  const updateBlock = useCallback((blockId: string, updates: Partial<EmailBlock>) => {
    setDoc((prev) => ({
      ...prev,
      sections: prev.sections.map((s) => ({
        ...s,
        columns: s.columns.map((col) =>
          col.map((b) => (b.id === blockId ? ({ ...b, ...updates } as EmailBlock) : b)),
        ),
      })),
    }))
  }, [setDoc])

  const removeBlock = useCallback((blockId: string) => {
    setDoc((prev) => ({
      ...prev,
      sections: prev.sections.map((s) => ({
        ...s,
        columns: s.columns.map((col) => col.filter((b) => b.id !== blockId)),
      })),
    }))
    setSelectedBlockId((cur) => (cur === blockId ? null : cur))
  }, [setDoc])

  const duplicateBlock = useCallback((blockId: string) => {
    const loc = findBlockLocation(doc, blockId)
    if (!loc) return
    const block = doc.sections.find((s) => s.id === loc.sectionId)?.columns[loc.colIdx][loc.index]
    if (!block) return
    const clone = cloneBlock(block)
    setDoc((prev) => insertBlockInColumn(prev, loc.sectionId, loc.colIdx, loc.index + 1, clone))
    setSelectedBlockId(clone.id)
  }, [doc, setDoc])

  const moveBlockDir = useCallback((blockId: string, dir: -1 | 1) => {
    const loc = findBlockLocation(doc, blockId)
    if (!loc) return
    const col = doc.sections.find((s) => s.id === loc.sectionId)?.columns[loc.colIdx] ?? []
    const target = loc.index + dir
    if (target < 0 || target >= col.length) return
    setDoc((prev) => moveBlock(prev, blockId, loc.sectionId, loc.colIdx, target))
  }, [doc, setDoc])

  // ── Save as section template ─────────────────────────────────────────────────────
  const [saveSectionOpen, setSaveSectionOpen] = useState(false)
  const [saveSectionName, setSaveSectionName] = useState('')
  const [targetSectionForSave, setTargetSectionForSave] = useState<string | null>(null)

  const openSaveSectionTemplate = useCallback((sectionId: string) => {
    setTargetSectionForSave(sectionId)
    setSaveSectionOpen(true)
  }, [])

  // ── Editor API (context value) ───────────────────────────────────────────────────
  const api: EditorApi = useMemo(() => ({
    doc,
    variant,
    subjectLine,
    previewText,
    setSubjectLine,
    setPreviewText,
    selectedSectionId,
    selectedBlockId,
    selectBlock,
    selectSection,
    addSection,
    removeSection,
    duplicateSection,
    updateSection,
    moveSection,
    insertSectionTemplate,
    removeBlock,
    duplicateBlock,
    updateBlock,
    moveBlockDir,
    setDoc,
    sectionTemplates,
    openSaveSectionTemplate,
  }), [
    doc, variant, subjectLine, previewText, selectedSectionId, selectedBlockId, selectBlock, selectSection,
    addSection, removeSection, duplicateSection, updateSection, moveSection,
    insertSectionTemplate, removeBlock, duplicateBlock, updateBlock,
    moveBlockDir, setDoc, sectionTemplates, openSaveSectionTemplate,
  ])

  // ── Breadcrumb inline name editing ───────────────────────────────────────────────
  const { setSegmentNode } = useBreadcrumbOverride()
  const [nameEditing, setNameEditing] = useState(false)
  const [nameDraft, setNameDraft] = useState(template.name)
  useEffect(() => {
    setSegmentNode(
      template.id,
      nameEditing ? (
        <input
          autoFocus
          value={nameDraft}
          onChange={(e) => setNameDraft(e.target.value)}
          onBlur={() => {
            const next = nameDraft.trim()
            if (next && next !== name) setName(next)
            setNameEditing(false)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); (e.target as HTMLInputElement).blur() }
            else if (e.key === 'Escape') { setNameDraft(name); setNameEditing(false) }
          }}
          className="min-w-32 max-w-xs border-b border-border bg-transparent text-sm font-medium outline-none focus:border-primary"
        />
      ) : (
        <button
          type="button"
          onClick={() => { setNameDraft(name); setNameEditing(true) }}
          className="cursor-pointer text-sm font-medium hover:underline"
          title="Click to rename"
        >
          {name || 'Untitled'}
        </button>
      ),
    )
  }, [template.id, name, nameEditing, nameDraft, setSegmentNode])

  // ── Save / publish / preview ─────────────────────────────────────────────────────
  const [justSaved, setJustSaved] = useState(false)

  const flushSave = useCallback((current: EmailDocument) => {
    startTransition(async () => {
      const subject = subjectRef.current
      const preview = previewRef.current
      const snapshot = snapshotOf(current, subject, preview)
      const result = onSaveDocument
        ? await onSaveDocument(current, nameRef.current)
        : await saveTemplate(template.id, current, nameRef.current, subject, preview)
      if (!result.ok) {
        toast.error((result as { error?: string }).error ?? 'Save failed')
        return
      }
      setSavedSnapshot(snapshot)
      setJustSaved(true)
      toast.success(variant === 'section' ? 'Section saved' : 'Template saved')
    })
  }, [template.id, onSaveDocument, variant, snapshotOf])

  const handleSave = useCallback(() => runWithFreshDoc(flushSave), [runWithFreshDoc, flushSave])

  // ── Autosave (Phase 6) ───────────────────────────────────────────────────────────
  // Debounced, silent save ~2.5s after the last doc/subject/preview edit. Must
  // NOT blur the active contentEditable (unlike the manual Save path) — a
  // background autosave stealing focus mid-sentence would be worse than the
  // data-loss risk it's trying to prevent. So this reads docRef/subjectRef/
  // previewRef directly instead of going through runWithFreshDoc; the last
  // COMMITTED state is acceptable (an in-progress, not-yet-blurred edit is
  // picked up by the next tick once it commits, or by the next autosave).
  //
  // Skipped entirely for variant='section': the section-template editor is
  // opened for short, focused styling tweaks (no publish, no autosave
  // indicator built into that surface's toolbar chrome), and unlike the full
  // template editor it has no independent "discard" path if an autosave
  // landed a half-finished section — the explicit Save button is enough there.
  useEffect(() => {
    if (variant === 'section') return
    if (!isDirty || isPending) return
    const timer = setTimeout(() => {
      startTransition(async () => {
        const current = docRef.current
        const subject = subjectRef.current
        const preview = previewRef.current
        const snapshot = snapshotOf(current, subject, preview)
        const result = await saveTemplate(template.id, current, nameRef.current, subject, preview)
        if (!result.ok) {
          // Silent by design — no toast. isDirty stays true, so either the
          // next autosave tick retries, or the user's next manual Save
          // surfaces the error.
          return
        }
        setSavedSnapshot(snapshot)
        setJustSaved(true)
      })
    }, AUTOSAVE_DELAY_MS)
    return () => clearTimeout(timer)
  }, [doc, subjectLine, previewText, isDirty, isPending, variant, template.id, snapshotOf])

  // "Saved" is a transient confirmation, not a persistent state — fades after
  // a couple seconds (or immediately once the next edit makes it stale, via
  // the isDirty-takes-precedence render order below).
  useEffect(() => {
    if (!justSaved) return
    const timer = setTimeout(() => setJustSaved(false), 2500)
    return () => clearTimeout(timer)
  }, [justSaved])

  function handleTogglePublish() {
    const publishing = status !== 'published'
    startTransition(async () => {
      const result = publishing ? await publishTemplate(template.id) : await unpublishTemplate(template.id)
      if (!result.ok) { toast.error(result.error); return }
      setStatus(publishing ? 'published' : 'draft')
      toast.success(publishing ? 'Template published' : 'Template unpublished')
    })
  }

  const [previewOpen, setPreviewOpen] = useState(false)
  const [previewHtml, setPreviewHtml] = useState('')
  const [previewDevice, setPreviewDevice] = useState<'desktop' | 'mobile'>('desktop')
  const [previewSampleData, setPreviewSampleData] = useState(false)
  function handlePreview() {
    runWithFreshDoc((d) => {
      setPreviewHtml(renderTemplate(d, { subject: subjectRef.current, previewText: previewRef.current }).html)
      setPreviewOpen(true)
    })
  }
  // "Sample data" toggle (task 6): runs the pure, client-safe renderWithVariables
  // over the already-rendered HTML with a hardcoded sample contact/org, so the
  // preview shows what a real recipient would see instead of raw {{ tags }}.
  const previewHtmlDisplayed = previewSampleData ? renderWithVariables(previewHtml, SAMPLE_VARS) : previewHtml

  function handleSaveSectionTemplate() {
    if (!targetSectionForSave || !saveSectionName.trim()) return
    const section = doc.sections.find((s) => s.id === targetSectionForSave)
    if (!section) return
    startTransition(async () => {
      const result = await saveSectionTemplate(saveSectionName.trim(), { section })
      if (!result.ok) { toast.error(result.error); return }
      toast.success('Saved as section template')
      setSaveSectionOpen(false)
      setSaveSectionName('')
    })
  }

  async function handleDeleteSectionTemplate(id: string) {
    const result = await deleteSectionTemplate(id)
    if (!result.ok) { toast.error(result.error); return }
    setSectionTemplates((prev) => prev.filter((s) => s.id !== id))
    toast.success('Section template deleted')
  }
  const [sectionTemplatesOpen, setSectionTemplatesOpen] = useState(false)

  // ── Send test email ──────────────────────────────────────────────────────────────
  // `sendTestEmail` re-fetches the template server-side and renders its
  // PERSISTED `document` fresh (not the possibly-stale `html_snapshot`) — it
  // does not take a client-supplied document. That means a test send
  // reflects the last SAVED state, which autosave keeps within ~2.5s of the
  // editor; it does not include an edit still in flight this tick. Simpler
  // and safer than threading unsaved client state through a send path, and
  // consistent with "test send" implying "what's actually stored."
  function handleSendTest() {
    startTransition(async () => {
      const result = await sendTestEmail(template.id)
      if (!result.ok) { toast.error(result.error); return }
      toast.success('Test email sent')
    })
  }

  // ── Keyboard shortcuts ───────────────────────────────────────────────────────────
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const mod = e.metaKey || e.ctrlKey
      const el = document.activeElement as HTMLElement | null
      const editing = !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)

      if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); handleSave(); return }
      if (mod && e.key.toLowerCase() === 'z' && !editing) {
        e.preventDefault()
        if (e.shiftKey) redo(); else undo()
        return
      }
      if (mod && e.key.toLowerCase() === 'y' && !editing) { e.preventDefault(); redo(); return }
      if ((e.key === 'Delete' || e.key === 'Backspace') && !editing && selectedBlockId) {
        e.preventDefault(); removeBlock(selectedBlockId); return
      }
      if (e.key === 'Escape') { setSelectedBlockId(null); setSelectedSectionId(null) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [handleSave, undo, redo, removeBlock, selectedBlockId])

  // ── Drag and drop ────────────────────────────────────────────────────────────────
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  const [activeDrag, setActiveDrag] = useState<
    | { kind: 'palette'; blockType?: string; sectionTemplateName?: string }
    | { kind: 'block'; label: string }
    | { kind: 'section' }
    | null
  >(null)

  function parseColId(id: string): { sectionId: string; colIdx: number } | null {
    if (!id.startsWith('col:')) return null
    const rest = id.slice(4)
    const lastColon = rest.lastIndexOf(':')
    if (lastColon === -1) return null
    return { sectionId: rest.slice(0, lastColon), colIdx: Number(rest.slice(lastColon + 1)) }
  }

  function resolveDropTarget(overId: string): { sectionId: string; colIdx: number; index: number } | null {
    const asCol = parseColId(overId)
    if (asCol) {
      const section = docRef.current.sections.find((s) => s.id === asCol.sectionId)
      const len = section?.columns[asCol.colIdx]?.length ?? 0
      return { ...asCol, index: len }
    }
    const loc = findBlockLocation(docRef.current, overId)
    if (!loc) return null
    return { sectionId: loc.sectionId, colIdx: loc.colIdx, index: loc.index }
  }

  /** Section-template chips insert a whole NEW section rather than dropping
   *  into a column — this resolves "which section to insert after" from
   *  whatever the drop landed on (a column, a block, or the section itself). */
  function resolveSectionForInsert(overId: string): string | null {
    const target = resolveDropTarget(overId)
    if (target) return target.sectionId
    const section = docRef.current.sections.find((s) => s.id === overId)
    return section ? section.id : null
  }

  function handleDragStart(event: DragStartEvent) {
    const data = event.active.data.current
    const id = String(event.active.id)
    if (data?.type === 'palette') {
      setActiveDrag({
        kind: 'palette',
        blockType: data.blockType as string | undefined,
        sectionTemplateName: sectionTemplates.find((s) => s.id === data.sectionTemplateId)?.name,
      })
    } else if (data?.type === 'block' || findBlockLocation(docRef.current, id)) {
      const b = docRef.current.sections.flatMap((s) => s.columns.flat()).find((x) => x.id === id)
      setActiveDrag({ kind: 'block', label: b?.blockType ?? 'block' })
    } else {
      setActiveDrag({ kind: 'section' })
    }
  }

  function handleDragOver(_e: DragOverEvent): void { void _e }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    setActiveDrag(null)
    if (!over) return
    const activeId = String(active.id)
    const overId = String(over.id)
    const data = active.data.current

    // 1. Palette → insert fresh block(s), or a whole new section.
    if (data?.type === 'palette') {
      if (data.source === 'section') {
        const st = sectionTemplates.find((s) => s.id === data.sectionTemplateId)
        if (!st) return
        insertSectionTemplate(resolveSectionForInsert(overId), st)
        return
      }
      const target = resolveDropTarget(overId)
      if (!target) return
      const type = data.blockType as EmailBlockType
      const fresh = { ...BLOCK_DEFAULTS[type], id: makeBlockId() } as EmailBlock
      setDoc((prev) => insertBlockInColumn(prev, target.sectionId, target.colIdx, target.index, fresh))
      setSelectedBlockId(fresh.id)
      return
    }

    // 2. Block → move within a column, between columns, or across sections
    //    (moveBlock already supports cross-section moves; only guard the
    //    true same-position no-op — same section AND same column AND same
    //    index — everything else is a real move).
    if (data?.type === 'block' || findBlockLocation(docRef.current, activeId)) {
      const from = findBlockLocation(docRef.current, activeId)
      const target = resolveDropTarget(overId)
      if (!from || !target) return
      if (from.sectionId === target.sectionId && from.colIdx === target.colIdx && from.index === target.index) return
      setDoc((prev) => moveBlock(prev, activeId, target.sectionId, target.colIdx, target.index))
      setSelectedBlockId(activeId)
      return
    }

    // 3. Section reorder.
    if (activeId !== overId) {
      setDoc((prev) => {
        const oldIndex = prev.sections.findIndex((s) => s.id === activeId)
        const newIndex = prev.sections.findIndex((s) => s.id === overId)
        if (oldIndex === -1 || newIndex === -1) return prev
        return { ...prev, sections: arrayMove(prev.sections, oldIndex, newIndex) }
      })
    }
  }

  function renderDragOverlay() {
    if (!activeDrag) return null
    if (activeDrag.kind === 'palette') {
      return (
        <div className="rounded border border-primary bg-card px-2 py-1.5 text-xs capitalize shadow-md">
          {activeDrag.blockType ?? activeDrag.sectionTemplateName ?? 'block'}
        </div>
      )
    }
    if (activeDrag.kind === 'block') {
      return <div className="rounded border border-primary bg-white px-2 py-1.5 text-xs capitalize shadow-md">{activeDrag.label}</div>
    }
    return <div className="rounded border border-primary bg-white px-3 py-2 text-xs shadow-md">Section</div>
  }

  // ── Render ───────────────────────────────────────────────────────────────────────
  return (
    <EditorContext.Provider value={api}>
      <div className="flex h-full overflow-hidden">
        <DndContext
          sensors={sensors}
          collisionDetection={closestCorners}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDragEnd={handleDragEnd}
        >
          <BlockPalette sectionTemplates={sectionTemplates} />

          <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
            {/* Toolbar */}
            <div className="flex h-10 shrink-0 items-center gap-1 overflow-x-auto border-b border-border bg-card/80 px-3">
              <div className="mr-2 flex items-center gap-0.5">
                <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={undo} disabled={!canUndo} title="Undo (⌘Z)">
                  <Undo2 className="h-3.5 w-3.5" />
                </Button>
                <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={redo} disabled={!canRedo} title="Redo (⌘⇧Z)">
                  <Redo2 className="h-3.5 w-3.5" />
                </Button>
              </div>

              {variant === 'section' ? (
                <div className="flex items-center gap-1.5">
                  <Badge variant="outline" className="h-5 gap-1 text-[10px]">
                    <Layers className="h-3 w-3" /> Section template
                  </Badge>
                  {onSectionTypeChange && (
                    <Select value={sectionType ?? 'custom'} onValueChange={onSectionTypeChange}>
                      <SelectTrigger className="h-6 gap-1 px-2 text-[11px] capitalize">
                        <SelectValue placeholder="Type" />
                      </SelectTrigger>
                      <SelectContent>
                        {SECTION_TYPES.map((t) => (
                          <SelectItem key={t} value={t} className="capitalize">{t}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>
              ) : (
                <Badge variant={status === 'published' ? 'default' : 'outline'} className="h-5 text-[10px] capitalize">
                  {status}
                </Badge>
              )}
              {/* Save status — isDirty always wins so a fresh edit immediately
                  hides a lingering "Saved" from a moment ago. isPending covers
                  BOTH manual Save and the silent autosave (same transition). */}
              {isPending ? (
                <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                  <Loader2 className="h-2.5 w-2.5 animate-spin" /> Saving…
                </span>
              ) : isDirty ? (
                <span className="flex items-center gap-1 text-[11px] text-amber-600" title="Unsaved changes">
                  <Circle className="h-2 w-2 fill-current" /> Unsaved
                </span>
              ) : justSaved ? (
                <span className="flex items-center gap-1 text-[11px] text-emerald-600">
                  <Check className="h-3 w-3" /> Saved
                </span>
              ) : null}

              <div className="ml-auto flex items-center gap-1">
                {variant === 'template' && (
                  <Button size="sm" variant="ghost" className="h-7 gap-1 text-xs" onClick={() => setSectionTemplatesOpen(true)}>
                    <Layers className="h-3.5 w-3.5" /> Sections
                  </Button>
                )}
                <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" onClick={handlePreview}>
                  <Eye className="h-3.5 w-3.5" /> Preview
                </Button>
                {variant === 'template' && (
                  <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" onClick={handleSendTest} disabled={isPending} title="Send a test copy to your own email">
                    <TestTube2 className="h-3.5 w-3.5" /> Send test
                  </Button>
                )}
                {variant === 'template' && (
                  <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" onClick={handleTogglePublish} disabled={isPending}>
                    {status === 'published' ? <Undo2 className="h-3.5 w-3.5" /> : <Send className="h-3.5 w-3.5" />}
                    {status === 'published' ? 'Unpublish' : 'Publish'}
                  </Button>
                )}
                <Button size="sm" className="h-7 gap-1 text-xs" onClick={handleSave} disabled={isPending}>
                  {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                  Save
                </Button>
              </div>
            </div>

            <Canvas />
          </div>

          <DragOverlay>{renderDragOverlay()}</DragOverlay>
        </DndContext>

        <InspectorPanel />
      </div>

      {/* Section templates management dialog */}
      <Dialog open={sectionTemplatesOpen} onOpenChange={setSectionTemplatesOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader className="mb-2">
            <DialogTitle>Section Templates</DialogTitle>
            <DialogDescription>
              Saved sections you can drag from the palette to insert as a new section, complete with their layout, background, and padding.
            </DialogDescription>
          </DialogHeader>
          <ScrollArea className="max-h-[60vh]">
            <div className="space-y-2 pr-1">
              {sectionTemplates.length === 0 && (
                <p className="py-6 text-center text-xs text-muted-foreground">
                  No section templates yet. Use a section&apos;s bookmark icon to save one.
                </p>
              )}
              {sectionTemplates.map((st) => (
                <div key={st.id} className="flex items-start justify-between gap-2 rounded border border-border p-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-xs font-medium leading-tight">{st.name}</p>
                    <Badge variant="outline" className="mt-1 text-[10px]">{st.section_type}</Badge>
                  </div>
                  <Button size="icon" variant="ghost" className="h-6 w-6 shrink-0 text-destructive hover:text-destructive" onClick={() => handleDeleteSectionTemplate(st.id)}>
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              ))}
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>

      {/* Preview dialog */}
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="flex h-[85vh] flex-col gap-0 p-0 sm:max-w-4xl">
          <DialogHeader className="flex flex-row items-center justify-between border-b border-border px-6 py-3">
            <DialogTitle className="text-sm font-medium">Preview — {name}</DialogTitle>
            <div className="mr-6 flex items-center gap-3">
              {variant === 'template' && (
                <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Switch size="sm" checked={previewSampleData} onCheckedChange={setPreviewSampleData} />
                  Sample data
                </label>
              )}
              <div className="inline-flex overflow-hidden rounded border border-border">
                <button
                  type="button"
                  onClick={() => setPreviewDevice('desktop')}
                  className={cn('flex h-7 items-center gap-1 px-2.5 text-xs', previewDevice === 'desktop' ? 'bg-primary text-primary-foreground' : 'bg-background text-muted-foreground')}
                >
                  <Monitor className="h-3.5 w-3.5" /> Desktop
                </button>
                <button
                  type="button"
                  onClick={() => setPreviewDevice('mobile')}
                  className={cn('flex h-7 items-center gap-1 border-l border-border px-2.5 text-xs', previewDevice === 'mobile' ? 'bg-primary text-primary-foreground' : 'bg-background text-muted-foreground')}
                >
                  <Smartphone className="h-3.5 w-3.5" /> Mobile
                </button>
              </div>
            </div>
          </DialogHeader>
          <div className="flex flex-1 justify-center overflow-auto bg-muted/40 p-4">
            <iframe
              srcDoc={previewHtmlDisplayed}
              title="Email preview"
              sandbox="allow-same-origin"
              className="h-full border-0 bg-white shadow-sm transition-all"
              style={{ width: previewDevice === 'mobile' ? 390 : '100%', maxWidth: previewDevice === 'mobile' ? 390 : 800 }}
            />
          </div>
        </DialogContent>
      </Dialog>

      {/* Save as section template dialog */}
      <Dialog open={saveSectionOpen} onOpenChange={setSaveSectionOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader className="mb-2">
            <DialogTitle>Save as Section Template</DialogTitle>
            <DialogDescription>Save this section so you can reuse it in any template.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Section name</Label>
              <Input value={saveSectionName} onChange={(e) => setSaveSectionName(e.target.value)} placeholder="e.g. Company Header" />
            </div>
            <Button className="w-full" onClick={handleSaveSectionTemplate} disabled={!saveSectionName.trim() || isPending}>
              {isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Save section
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </EditorContext.Provider>
  )
}
