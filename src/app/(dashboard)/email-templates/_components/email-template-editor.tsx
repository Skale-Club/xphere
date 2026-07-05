'use client'

import { useState, useTransition, useCallback, useEffect, useMemo, useRef } from 'react'
import { toast } from 'sonner'
import {
  Save, Eye, Loader2, Send, Undo2, Redo2, Trash2,
  Smartphone, Monitor, Circle, Layers,
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
import { renderTemplate, BLOCK_DEFAULTS, makeBlockId, normalizeDocument } from '@/lib/email/render-template'
import { findBlockLocation, insertBlockInColumn, moveBlock } from '@/lib/email/editor-dnd'
import {
  saveTemplate, saveSectionTemplate, deleteSectionTemplate, publishTemplate, unpublishTemplate,
} from '../actions'
import type { EmailTemplateBuilderRow, SectionTemplate } from '../actions'
import { BlockPalette } from './block-palette'
import { Canvas } from './editor/canvas'
import { InspectorPanel } from './editor/inspector-panel'
import { EditorContext, type EditorApi } from './editor/context'
import { useEditorHistory } from './editor/use-editor-history'

type SaveResult = { ok: true } | { ok: false; error?: string }

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
  const [isPending, startTransition] = useTransition()
  const [sectionTemplates, setSectionTemplates] = useState<SectionTemplate[]>(initialSectionTemplates)
  const [selectedSectionId, setSelectedSectionId] = useState<string | null>(null)
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null)

  const [savedSnapshot, setSavedSnapshot] = useState(() => JSON.stringify(initialDoc))
  const isDirty = useMemo(() => JSON.stringify(doc) !== savedSnapshot, [doc, savedSnapshot])

  // Live refs so save/preview always read the freshest committed doc/name even
  // when triggered from a keyboard shortcut in the same tick as a blur commit.
  // Synced in an effect (never during render) so ref reads in event handlers /
  // rAF callbacks always see the last committed value.
  const docRef = useRef(doc)
  const nameRef = useRef(name)
  useEffect(() => {
    docRef.current = doc
    nameRef.current = name
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
  const addBlock = useCallback((sectionId: string, colIdx: number, blockType: EmailBlockType) => {
    const block = { ...BLOCK_DEFAULTS[blockType], id: makeBlockId() } as EmailBlock
    setDoc((prev) => insertBlockInColumn(prev, sectionId, colIdx, Number.MAX_SAFE_INTEGER, block))
    setSelectedBlockId(block.id)
  }, [setDoc])

  const insertSectionTemplate = useCallback((sectionId: string, colIdx: number, st: SectionTemplate) => {
    const source = (st.document as { blocks?: EmailBlock[] }).blocks ?? []
    if (!source.length) return
    setDoc((prev) => {
      let next = prev
      source.forEach((b) => {
        next = insertBlockInColumn(next, sectionId, colIdx, Number.MAX_SAFE_INTEGER, cloneBlock(b))
      })
      return next
    })
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
    selectedSectionId,
    selectedBlockId,
    selectBlock,
    selectSection,
    addSection,
    removeSection,
    duplicateSection,
    updateSection,
    moveSection,
    addBlock,
    insertSectionTemplate,
    removeBlock,
    duplicateBlock,
    updateBlock,
    moveBlockDir,
    setDoc,
    sectionTemplates,
    openSaveSectionTemplate,
  }), [
    doc, variant, selectedSectionId, selectedBlockId, selectBlock, selectSection,
    addSection, removeSection, duplicateSection, updateSection, moveSection,
    addBlock, insertSectionTemplate, removeBlock, duplicateBlock, updateBlock,
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
  const flushSave = useCallback((current: EmailDocument) => {
    startTransition(async () => {
      const snapshot = JSON.stringify(current)
      const result = onSaveDocument
        ? await onSaveDocument(current, nameRef.current)
        : await saveTemplate(template.id, current, nameRef.current)
      if (!result.ok) {
        toast.error((result as { error?: string }).error ?? 'Save failed')
        return
      }
      setSavedSnapshot(snapshot)
      toast.success(variant === 'section' ? 'Section saved' : 'Template saved')
    })
  }, [template.id, onSaveDocument, variant])

  const handleSave = useCallback(() => runWithFreshDoc(flushSave), [runWithFreshDoc, flushSave])

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
  function handlePreview() {
    runWithFreshDoc((d) => {
      setPreviewHtml(renderTemplate(d).html)
      setPreviewOpen(true)
    })
  }

  function handleSaveSectionTemplate() {
    if (!targetSectionForSave || !saveSectionName.trim()) return
    const section = doc.sections.find((s) => s.id === targetSectionForSave)
    if (!section) return
    const blocks = section.columns.flat()
    startTransition(async () => {
      const result = await saveSectionTemplate(saveSectionName.trim(), { blocks })
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

    // 1. Palette → insert fresh block(s).
    if (data?.type === 'palette') {
      const target = resolveDropTarget(overId)
      if (!target) return
      if (data.source === 'section') {
        const st = sectionTemplates.find((s) => s.id === data.sectionTemplateId)
        const src = (st?.document as { blocks?: EmailBlock[] })?.blocks ?? []
        if (!src.length) return
        setDoc((prev) => {
          let next = prev
          src.forEach((b, i) => {
            next = insertBlockInColumn(next, target.sectionId, target.colIdx, target.index + i, cloneBlock(b))
          })
          return next
        })
        return
      }
      const type = data.blockType as EmailBlockType
      const fresh = { ...BLOCK_DEFAULTS[type], id: makeBlockId() } as EmailBlock
      setDoc((prev) => insertBlockInColumn(prev, target.sectionId, target.colIdx, target.index, fresh))
      setSelectedBlockId(fresh.id)
      return
    }

    // 2. Block → move within/between columns of the same section.
    if (data?.type === 'block' || findBlockLocation(docRef.current, activeId)) {
      const from = findBlockLocation(docRef.current, activeId)
      const target = resolveDropTarget(overId)
      if (!from || !target) return
      if (target.sectionId !== from.sectionId) return
      if (from.colIdx === target.colIdx && from.index === target.index) return
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
              {isDirty && (
                <span className="flex items-center gap-1 text-[11px] text-amber-600" title="Unsaved changes">
                  <Circle className="h-2 w-2 fill-current" /> Unsaved
                </span>
              )}

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
              Saved sections you can drag in from the palette or insert via a column&apos;s &quot;Add block&quot; menu.
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
            <div className="mr-6 inline-flex overflow-hidden rounded border border-border">
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
          </DialogHeader>
          <div className="flex flex-1 justify-center overflow-auto bg-muted/40 p-4">
            <iframe
              srcDoc={previewHtml}
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
