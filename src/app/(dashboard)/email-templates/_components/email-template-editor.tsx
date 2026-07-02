'use client'

import { useState, useTransition, useCallback, useId, useEffect, useRef, Fragment } from 'react'
import { toast } from 'sonner'
import {
  Save, Eye, Plus, Trash2, Loader2, GripVertical,
  Type, Image, MousePointerClick, Minus, AlignJustify, Bookmark,
  X, Settings, Code,
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
import { Separator } from '@/components/ui/separator'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'

import {
  DndContext, KeyboardSensor, PointerSensor,
  useSensor, useSensors, DragEndEvent, DragStartEvent, DragOverEvent,
  DragOverlay, useDroppable, closestCorners,
} from '@dnd-kit/core'
import type { DraggableAttributes, DraggableSyntheticListeners } from '@dnd-kit/core'
import {
  SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy,
  useSortable, arrayMove,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

import type {
  EmailDocument, EmailSection, EmailBlock,
  TextBlock, HeadingBlock, ImageBlock, ButtonBlock, DividerBlock, SpacerBlock, HtmlBlock,
} from '@/lib/email/render-template'
import { renderTemplate, BLOCK_DEFAULTS, makeBlockId, normalizeDocument } from '@/lib/email/render-template'
import { findBlockLocation, insertBlockInColumn, moveBlock } from '@/lib/email/editor-dnd'
import { saveTemplate, saveReusableBlock, deleteReusableBlock } from '../actions'
import type { EmailTemplateBuilderRow, ReusableBlock } from '../actions'
import { BlockPalette } from './block-palette'

// ─── Types ────────────────────────────────────────────────────────────────────

interface EmailTemplateEditorProps {
  template: EmailTemplateBuilderRow
  reusableBlocks: ReusableBlock[]
}

type ActivePanel = 'blocks' | 'reusable' | null

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeId() {
  return Math.random().toString(36).slice(2, 10)
}

function makeSection(layout: 1 | 2 | 3 = 1): EmailSection {
  return {
    id: makeId(),
    layout,
    backgroundColor: '#ffffff',
    padding: { top: 16, right: 24, bottom: 16, left: 24 },
    columns: Array.from({ length: layout }, () => []),
  }
}

// Shared block-type list — the source of truth for both the left palette
// (block-palette.tsx) and the in-column `+ Block` menu below.
export const BLOCK_TYPES: { type: string; label: string; icon: React.ReactNode }[] = [
  { type: 'heading', label: 'Heading', icon: <Type className="h-3 w-3" /> },
  { type: 'text', label: 'Text', icon: <AlignJustify className="h-3 w-3" /> },
  { type: 'image', label: 'Image', icon: <Image className="h-3 w-3" /> },
  { type: 'button', label: 'Button', icon: <MousePointerClick className="h-3 w-3" /> },
  { type: 'divider', label: 'Divider', icon: <Minus className="h-3 w-3" /> },
  { type: 'spacer', label: 'Spacer', icon: <AlignJustify className="h-3 w-3" /> },
  { type: 'html', label: 'HTML', icon: <Code className="h-3 w-3" /> },
]

// ─── Main editor ─────────────────────────────────────────────────────────────

export function EmailTemplateEditor({ template, reusableBlocks: initialBlocks }: EmailTemplateEditorProps) {
  const [doc, setDoc] = useState<EmailDocument>(() => normalizeDocument(template.document))
  const [name, setName] = useState(template.name)
  const [isPending, startTransition] = useTransition()
  const [previewOpen, setPreviewOpen] = useState(false)
  const [previewHtml, setPreviewHtml] = useState('')
  const [activePanel, setActivePanel] = useState<ActivePanel>(null)
  const [reusableBlocks, setReusableBlocks] = useState<ReusableBlock[]>(initialBlocks)
  const [selectedSectionId, setSelectedSectionId] = useState<string | null>(null)
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null)
  const [docSettingsOpen, setDocSettingsOpen] = useState(false)

  // Replace the UUID segment in the global breadcrumb with an inline-editable
  // template name. Clicking the name reveals an input bound to the editor's
  // local `name` state; Save persists it.
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
            if (e.key === 'Enter') {
              e.preventDefault()
              ;(e.target as HTMLInputElement).blur()
            } else if (e.key === 'Escape') {
              setNameDraft(name)
              setNameEditing(false)
            }
          }}
          className="bg-transparent border-b border-border outline-none text-sm font-medium min-w-32 max-w-xs focus:border-accent"
        />
      ) : (
        <button
          type="button"
          onClick={() => {
            setNameDraft(name)
            setNameEditing(true)
          }}
          className="text-sm font-medium hover:underline cursor-pointer"
          title="Click to rename"
        >
          {name || 'Untitled'}
        </button>
      ),
    )
  }, [template.id, name, nameEditing, nameDraft, setSegmentNode])

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  // ── Document mutations ──────────────────────────────────────────────────────

  const addSection = useCallback((layout: 1 | 2 | 3 = 1) => {
    const section = makeSection(layout)
    setDoc((prev) => ({ ...prev, sections: [...prev.sections, section] }))
    setSelectedSectionId(section.id)
  }, [])

  const removeSection = useCallback((sectionId: string) => {
    setDoc((prev) => ({ ...prev, sections: prev.sections.filter((s) => s.id !== sectionId) }))
    setSelectedSectionId(null)
  }, [])

  const updateSection = useCallback((sectionId: string, updates: Partial<EmailSection>) => {
    setDoc((prev) => ({
      ...prev,
      sections: prev.sections.map((s) => s.id === sectionId ? { ...s, ...updates } : s),
    }))
  }, [])

  const addBlock = useCallback((sectionId: string, colIdx: number, blockType: string) => {
    const block = { ...BLOCK_DEFAULTS[blockType], id: makeBlockId() } as EmailBlock
    setDoc((prev) => ({
      ...prev,
      sections: prev.sections.map((s) => {
        if (s.id !== sectionId) return s
        const cols = s.columns.map((col, ci) => ci === colIdx ? [...col, block] : col)
        return { ...s, columns: cols }
      }),
    }))
    setSelectedBlockId(block.id)
  }, [])

  const insertReusableBlock = useCallback((sectionId: string, colIdx: number, rb: ReusableBlock) => {
    const source = (rb.document as { blocks?: EmailBlock[] }).blocks ?? []
    if (!source.length) return
    const blocks = source.map((b) => ({ ...b, id: makeBlockId() }))
    setDoc((prev) => ({
      ...prev,
      sections: prev.sections.map((s) => {
        if (s.id !== sectionId) return s
        const cols = s.columns.map((col, ci) => ci === colIdx ? [...col, ...blocks] : col)
        return { ...s, columns: cols }
      }),
    }))
  }, [])

  const removeBlock = useCallback((sectionId: string, colIdx: number, blockId: string) => {
    setDoc((prev) => ({
      ...prev,
      sections: prev.sections.map((s) => {
        if (s.id !== sectionId) return s
        const cols = s.columns.map((col, ci) => ci === colIdx ? col.filter((b) => b.id !== blockId) : col)
        return { ...s, columns: cols }
      }),
    }))
    setSelectedBlockId(null)
  }, [])

  const updateBlock = useCallback((sectionId: string, colIdx: number, blockId: string, updates: Partial<EmailBlock>) => {
    setDoc((prev) => ({
      ...prev,
      sections: prev.sections.map((s) => {
        if (s.id !== sectionId) return s
        const cols = s.columns.map((col, ci) => {
          if (ci !== colIdx) return col
          return col.map((b) => b.id !== blockId ? b : { ...b, ...updates } as EmailBlock)
        })
        return { ...s, columns: cols }
      }),
    }))
  }, [])

  // ── Drag-and-drop (single DndContext: palette insert + block move + section reorder) ──

  const [activeDrag, setActiveDrag] = useState<
    | { kind: 'section'; id: string }
    | { kind: 'block'; id: string }
    | { kind: 'palette'; blockType?: string; reusableName?: string }
    | null
  >(null)

  // Parse a `col:${sectionId}:${colIdx}` container id. Section ids are 8-char
  // base36 (no colons), so splitting on the LAST colon is safe.
  function parseColId(id: string): { sectionId: string; colIdx: number } | null {
    if (!id.startsWith('col:')) return null
    const rest = id.slice(4)
    const lastColon = rest.lastIndexOf(':')
    if (lastColon === -1) return null
    return { sectionId: rest.slice(0, lastColon), colIdx: Number(rest.slice(lastColon + 1)) }
  }

  // Resolve the `over` node into a concrete { sectionId, colIdx, index }.
  // `over` may be a `col:*` container/droppable id (empty col or container) OR a
  // block id (a sortable item) — drop before that block's position.
  function resolveDropTarget(overId: string): { sectionId: string; colIdx: number; index: number } | null {
    const asCol = parseColId(overId)
    if (asCol) {
      const section = doc.sections.find((s) => s.id === asCol.sectionId)
      const len = section?.columns[asCol.colIdx]?.length ?? 0
      return { ...asCol, index: len }
    }
    const loc = findBlockLocation(doc, overId)
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
        reusableName: reusableBlocks.find((r) => r.id === data.reusableId)?.name,
      })
    } else if (data?.type === 'block' || findBlockLocation(doc, id)) {
      setActiveDrag({ kind: 'block', id })
    } else {
      setActiveDrag({ kind: 'section', id })
    }
  }

  function handleDragOver(_event: DragOverEvent): void {
    // Intentionally a no-op: closestCorners + resolveDropTarget in onDragEnd
    // computes the final placement; the DragOverlay handles live feedback.
    void _event
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    setActiveDrag(null)
    if (!over) return
    const activeId = String(active.id)
    const overId = String(over.id)
    const data = active.data.current

    // 1. PALETTE → insert a fresh block at the drop target.
    if (data?.type === 'palette') {
      const target = resolveDropTarget(overId)
      if (!target) return
      if (data.source === 'reusable') {
        const rb = reusableBlocks.find((r) => r.id === data.reusableId)
        const src = (rb?.document as { blocks?: EmailBlock[] })?.blocks ?? []
        if (!src.length) return
        // Re-mint every block id; insert sequentially at the target index.
        let nextDoc = doc
        src.forEach((b, i) => {
          const minted = { ...b, id: makeBlockId() } as EmailBlock
          nextDoc = insertBlockInColumn(nextDoc, target.sectionId, target.colIdx, target.index + i, minted)
        })
        setDoc(nextDoc)
        return
      }
      const type = data.blockType as string
      const fresh = { ...BLOCK_DEFAULTS[type], id: makeBlockId() } as EmailBlock
      setDoc((prev) => insertBlockInColumn(prev, target.sectionId, target.colIdx, target.index, fresh))
      setSelectedBlockId(fresh.id)
      return
    }

    // 2. BLOCK → move within/between columns (NOT across sections — out of scope).
    if (data?.type === 'block' || findBlockLocation(doc, activeId)) {
      const from = findBlockLocation(doc, activeId)
      const target = resolveDropTarget(overId)
      if (!from || !target) return
      if (target.sectionId !== from.sectionId) return   // block cross-section move is out of scope
      if (from.colIdx === target.colIdx && from.index === target.index) return
      setDoc((prev) => moveBlock(prev, activeId, target.sectionId, target.colIdx, target.index))
      setSelectedBlockId(activeId)
      return
    }

    // 3. SECTION → existing reorder (unchanged).
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
        <div className="px-2 py-1.5 text-xs rounded border border-accent bg-card shadow-md">
          {activeDrag.blockType ?? activeDrag.reusableName ?? 'block'}
        </div>
      )
    }
    if (activeDrag.kind === 'block') {
      const b = doc.sections.flatMap((s) => s.columns.flat()).find((x) => x.id === activeDrag.id)
      return (
        <div className="px-2 py-1.5 text-xs rounded border border-blue-500 bg-white shadow-md capitalize">
          {b?.blockType ?? 'block'}
        </div>
      )
    }
    return <div className="px-3 py-2 text-xs rounded border border-blue-500 bg-white shadow-md">Section</div>
  }

  // ── Save ────────────────────────────────────────────────────────────────────

  function handleSave() {
    startTransition(async () => {
      const result = await saveTemplate(template.id, doc, name)
      if (!result.ok) { toast.error(result.error); return }
      toast.success('Template saved')
    })
  }

  // ── Preview ─────────────────────────────────────────────────────────────────

  function handlePreview() {
    const { html } = renderTemplate(doc)
    setPreviewHtml(html)
    setPreviewOpen(true)
  }

  // ── Save as reusable block ──────────────────────────────────────────────────

  const [saveBlockName, setSaveBlockName] = useState('')
  const [saveBlockType, setSaveBlockType] = useState('header')
  const [saveBlockOpen, setSaveBlockOpen] = useState(false)
  const [targetSectionForSave, setTargetSectionForSave] = useState<string | null>(null)

  function openSaveBlock(sectionId: string) {
    setTargetSectionForSave(sectionId)
    setSaveBlockOpen(true)
  }

  function handleSaveAsReusable() {
    if (!targetSectionForSave || !saveBlockName.trim()) return
    const section = doc.sections.find((s) => s.id === targetSectionForSave)
    if (!section) return
    const blocks = section.columns.flat()
    startTransition(async () => {
      const result = await saveReusableBlock(saveBlockName.trim(), saveBlockType, { blocks })
      if (!result.ok) { toast.error(result.error); return }
      toast.success('Saved as reusable block')
      setSaveBlockOpen(false)
      setSaveBlockName('')
    })
  }

  async function handleDeleteReusable(id: string) {
    const result = await deleteReusableBlock(id)
    if (!result.ok) { toast.error(result.error); return }
    setReusableBlocks((prev) => prev.filter((b) => b.id !== id))
    toast.success('Reusable block deleted')
  }

  const selectedBlock = selectedBlockId
    ? doc.sections.flatMap((s) => s.columns.flat()).find((b) => b.id === selectedBlockId) ?? null
    : null

  return (
    <div className="flex h-full overflow-hidden">
      {/* ── ONE DndContext wrapping palette + canvas (they share drag state) ──── */}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
      >
        {/* ── Left palette (draggable block-type + reusable chips) ───────────── */}
        <BlockPalette reusableBlocks={reusableBlocks} />

        {/* ── Canvas ──────────────────────────────────────────────────────────── */}
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Toolbar */}
        <div className="flex items-center gap-2 px-4 py-2 border-b border-border bg-card/80 shrink-0 flex-wrap gap-y-1">
          <div className="flex items-center gap-1 ml-auto">
            <Button
              size="sm"
              variant="ghost"
              className="h-7 gap-1 text-xs"
              onClick={() => setDocSettingsOpen(true)}
            >
              <Settings className="h-3.5 w-3.5" />
              Settings
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 gap-1 text-xs"
              onClick={() => setActivePanel((p) => p === 'reusable' ? null : 'reusable')}
            >
              <Bookmark className="h-3.5 w-3.5" />
              Reusable
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-7 gap-1 text-xs"
              onClick={handlePreview}
            >
              <Eye className="h-3.5 w-3.5" />
              Preview
            </Button>
            <Button
              size="sm"
              className="h-7 gap-1 text-xs"
              onClick={handleSave}
              disabled={isPending}
            >
              {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
              Save
            </Button>
          </div>
        </div>

        {/* Sections canvas */}
        <ScrollArea className="flex-1">
          <div className="py-8 px-4 flex flex-col items-center gap-0 min-h-full">
            <div
              className="w-full bg-white shadow-sm rounded overflow-hidden"
              style={{ maxWidth: `${doc.contentWidth ?? 600}px`, backgroundColor: doc.backgroundColor ?? '#f0f0f0' }}
            >
              <SortableContext items={doc.sections.map((s) => s.id)} strategy={verticalListSortingStrategy}>
                {doc.sections.map((section) => (
                  <SortableSection
                      key={section.id}
                      section={section}
                      isSelected={selectedSectionId === section.id}
                      selectedBlockId={selectedBlockId}
                      onSelect={() => setSelectedSectionId(section.id)}
                      onRemove={() => removeSection(section.id)}
                      onUpdate={(u) => updateSection(section.id, u)}
                      onAddBlock={(colIdx, type) => addBlock(section.id, colIdx, type)}
                      onInsertReusable={(colIdx, rb) => insertReusableBlock(section.id, colIdx, rb)}
                      onRemoveBlock={(colIdx, blockId) => removeBlock(section.id, colIdx, blockId)}
                      onUpdateBlock={(colIdx, blockId, u) => updateBlock(section.id, colIdx, blockId, u)}
                      onSelectBlock={(blockId) => setSelectedBlockId(blockId)}
                      onSaveAsReusable={() => openSaveBlock(section.id)}
                      reusableBlocks={reusableBlocks}
                    />
                ))}
              </SortableContext>

              {/* Add section buttons */}
              <div className="px-4 py-4 flex items-center gap-2 flex-wrap border-t border-dashed border-zinc-300 bg-zinc-50">
                <span className="text-xs text-zinc-700 font-medium mr-1">Add section:</span>
                {([1, 2, 3] as const).map((layout) => (
                  <Button
                    key={layout}
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs gap-1 bg-white border-zinc-400 text-zinc-800 hover:bg-zinc-100 hover:border-zinc-500 hover:text-zinc-900"
                    onClick={() => addSection(layout)}
                  >
                    <Plus className="h-3 w-3" />
                    {layout}-col
                  </Button>
                ))}
              </div>
            </div>
          </div>
        </ScrollArea>
        </div>

        {/* ── Drag ghost ─────────────────────────────────────────────────────── */}
        <DragOverlay>{renderDragOverlay()}</DragOverlay>
      </DndContext>

      {/* ── Reusable blocks dialog ───────────────────────────────────────────── */}
      <Dialog
        open={activePanel === 'reusable'}
        onOpenChange={(open) => setActivePanel(open ? 'reusable' : null)}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader className="mb-2">
            <DialogTitle>Reusable Blocks</DialogTitle>
            <DialogDescription>
              Insert a saved block into any section via the section&apos;s &quot;Insert&quot; menu.
            </DialogDescription>
          </DialogHeader>
          <ScrollArea className="max-h-[60vh]">
            <div className="space-y-2 pr-1">
              {reusableBlocks.length === 0 && (
                <p className="text-xs text-muted-foreground text-center py-6">
                  No reusable blocks yet. Save a section as a reusable block to see it here.
                </p>
              )}
              {reusableBlocks.map((rb) => (
                <div key={rb.id} className="rounded border border-border p-2.5 space-y-1">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-xs font-medium leading-tight truncate">{rb.name}</p>
                      <Badge variant="outline" className="text-[10px] mt-1">{rb.block_type}</Badge>
                    </div>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-6 w-6 text-destructive hover:text-destructive shrink-0"
                      onClick={() => handleDeleteReusable(rb.id)}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>

      {/* ── Document settings dialog ─────────────────────────────────────────── */}
      <Dialog open={docSettingsOpen} onOpenChange={setDocSettingsOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader className="mb-2">
            <DialogTitle>Settings</DialogTitle>
            <DialogDescription>
              Global settings applied to the whole email.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 px-1">
            <div className="space-y-1.5">
              <Label className="text-xs">Background color (outside the email)</Label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={doc.backgroundColor ?? '#f0f0f0'}
                  onChange={(e) => setDoc((p) => ({ ...p, backgroundColor: e.target.value }))}
                  className="w-10 h-8 rounded border border-zinc-300 cursor-pointer"
                />
                <Input
                  type="text"
                  value={doc.backgroundColor ?? '#f0f0f0'}
                  onChange={(e) => setDoc((p) => ({ ...p, backgroundColor: e.target.value }))}
                  className="h-8 text-xs font-mono"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Content width (px)</Label>
              <Input
                type="number"
                min={320}
                max={900}
                value={doc.contentWidth ?? 600}
                onChange={(e) => setDoc((p) => ({ ...p, contentWidth: Number(e.target.value) }))}
                className="h-8 text-xs"
              />
              <p className="text-[11px] text-muted-foreground">Most email clients render best between 560–680 px.</p>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Font family</Label>
              <Select
                value={doc.fontFamily ?? "Arial, Helvetica, sans-serif"}
                onValueChange={(v) => setDoc((p) => ({ ...p, fontFamily: v }))}
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Arial, Helvetica, sans-serif">Arial / Helvetica</SelectItem>
                  <SelectItem value="Georgia, serif">Georgia</SelectItem>
                  <SelectItem value="'Times New Roman', Times, serif">Times New Roman</SelectItem>
                  <SelectItem value="Verdana, Geneva, sans-serif">Verdana</SelectItem>
                  <SelectItem value="'Trebuchet MS', sans-serif">Trebuchet MS</SelectItem>
                  <SelectItem value="'Courier New', Courier, monospace">Courier New</SelectItem>
                  <SelectItem value="system-ui, -apple-system, sans-serif">System UI</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground">Use only email-safe fonts. Custom web fonts won&apos;t render in most clients.</p>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Preview dialog ───────────────────────────────────────────────────── */}
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="sm:max-w-4xl p-0 flex flex-col h-[80vh] gap-0">
          <DialogHeader className="px-6 py-4 border-b border-border shrink-0">
            <DialogTitle className="text-sm font-medium">HTML Preview — {name}</DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-hidden">
            <iframe
              srcDoc={previewHtml}
              className="w-full h-full border-0"
              title="Email preview"
              sandbox="allow-same-origin"
            />
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Save as reusable dialog ──────────────────────────────────────────── */}
      <Dialog open={saveBlockOpen} onOpenChange={setSaveBlockOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader className="mb-2">
            <DialogTitle>Save as Reusable Block</DialogTitle>
            <DialogDescription>
              Save this section&apos;s blocks as a reusable block that can be inserted into any template.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Block name</Label>
              <Input
                value={saveBlockName}
                onChange={(e) => setSaveBlockName(e.target.value)}
                placeholder="e.g. Company Header"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Block type</Label>
              <Select value={saveBlockType} onValueChange={setSaveBlockType}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {['header', 'footer', 'cta', 'logo', 'social', 'legal'].map((t) => (
                    <SelectItem key={t} value={t} className="capitalize">{t}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              className="w-full"
              onClick={handleSaveAsReusable}
              disabled={!saveBlockName.trim() || isPending}
            >
              {isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Save block
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ─── Sortable section ─────────────────────────────────────────────────────────

interface SortableSectionProps {
  section: EmailSection
  isSelected: boolean
  selectedBlockId: string | null
  onSelect: () => void
  onRemove: () => void
  onUpdate: (updates: Partial<EmailSection>) => void
  onAddBlock: (colIdx: number, blockType: string) => void
  onInsertReusable: (colIdx: number, rb: ReusableBlock) => void
  onRemoveBlock: (colIdx: number, blockId: string) => void
  onUpdateBlock: (colIdx: number, blockId: string, updates: Partial<EmailBlock>) => void
  onSelectBlock: (blockId: string) => void
  onSaveAsReusable: () => void
  reusableBlocks: ReusableBlock[]
}

function SortableSection({
  section, isSelected, selectedBlockId, onSelect, onRemove, onUpdate,
  onAddBlock, onInsertReusable, onRemoveBlock, onUpdateBlock, onSelectBlock,
  onSaveAsReusable, reusableBlocks,
}: SortableSectionProps) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: section.id })
  const style = { transform: CSS.Transform.toString(transform), transition }
  const colorInputRef = useRef<HTMLInputElement>(null)

  const padding = {
    top: section.padding?.top ?? 16,
    right: section.padding?.right ?? 24,
    bottom: section.padding?.bottom ?? 16,
    left: section.padding?.left ?? 24,
  }
  const columnsGap = section.columnsGap ?? 0

  return (
    <div
      ref={setNodeRef}
      style={{ ...style, backgroundColor: section.backgroundColor ?? '#ffffff' }}
      className={cn('group relative border-2 transition-colors', isSelected ? 'border-blue-500' : 'border-transparent hover:border-zinc-400')}
      onClick={onSelect}
    >
      {/* Section controls (floating pill, top-right) */}
      <div className="absolute top-1 right-1 flex items-center gap-0.5 opacity-60 group-hover:opacity-100 transition-opacity z-30 bg-white/95 rounded shadow-sm border border-zinc-200">
        <button
          {...attributes}
          {...listeners}
          className="cursor-grab active:cursor-grabbing h-6 w-6 flex items-center justify-center rounded text-zinc-600 hover:text-zinc-900 hover:bg-zinc-100"
          title="Drag to reorder"
        >
          <GripVertical className="h-3 w-3" />
        </button>
        <button
          className="h-6 w-6 flex items-center justify-center rounded text-zinc-600 hover:bg-zinc-100 relative"
          onClick={(e) => { e.stopPropagation(); colorInputRef.current?.click() }}
          title="Background color"
        >
          <span
            className="block w-3 h-3 rounded border border-zinc-400"
            style={{ backgroundColor: section.backgroundColor ?? '#ffffff' }}
          />
          <input
            ref={colorInputRef}
            type="color"
            value={section.backgroundColor ?? '#ffffff'}
            onChange={(e) => onUpdate({ backgroundColor: e.target.value })}
            onClick={(e) => e.stopPropagation()}
            className="absolute inset-0 opacity-0 cursor-pointer"
            tabIndex={-1}
          />
        </button>
        <button
          className="h-6 w-6 flex items-center justify-center rounded text-zinc-600 hover:text-blue-600 hover:bg-zinc-100"
          onClick={(e) => { e.stopPropagation(); onSaveAsReusable() }}
          title="Save as reusable block"
        >
          <Bookmark className="h-3 w-3" />
        </button>
        <button
          className="h-6 w-6 flex items-center justify-center rounded text-zinc-600 hover:text-red-600 hover:bg-zinc-100"
          onClick={(e) => { e.stopPropagation(); onRemove() }}
          title="Remove section"
        >
          <Trash2 className="h-3 w-3" />
        </button>
      </div>

      {/* Padding drag handles (one per edge) */}
      <PaddingDragHandle
        side="top"
        value={padding.top}
        onChange={(v) => onUpdate({ padding: { ...section.padding, top: v } })}
      />
      <PaddingDragHandle
        side="bottom"
        value={padding.bottom}
        onChange={(v) => onUpdate({ padding: { ...section.padding, bottom: v } })}
      />
      <PaddingDragHandle
        side="left"
        value={padding.left}
        onChange={(v) => onUpdate({ padding: { ...section.padding, left: v } })}
      />
      <PaddingDragHandle
        side="right"
        value={padding.right}
        onChange={(v) => onUpdate({ padding: { ...section.padding, right: v } })}
      />

      {/* Columns */}
      <div className="flex">
        {Array.from({ length: section.layout }).map((_, colIdx) => (
          <Fragment key={colIdx}>
            <ColumnEditor
              blocks={section.columns[colIdx] ?? []}
              colIdx={colIdx}
              layout={section.layout}
              sectionId={section.id}
              selectedBlockId={selectedBlockId}
              onAddBlock={(type) => onAddBlock(colIdx, type)}
              onInsertReusable={(rb) => onInsertReusable(colIdx, rb)}
              onRemoveBlock={(blockId) => onRemoveBlock(colIdx, blockId)}
              onUpdateBlock={(blockId, updates) => onUpdateBlock(colIdx, blockId, updates)}
              onSelectBlock={(blockId) => onSelectBlock(blockId)}
              reusableBlocks={reusableBlocks}
              padding={section.padding}
            />
            {section.layout > 1 && colIdx < section.layout - 1 && (
              <ColumnGapDragHandle
                value={columnsGap}
                onChange={(v) => onUpdate({ columnsGap: v })}
              />
            )}
          </Fragment>
        ))}
      </div>
    </div>
  )
}

// ─── Padding drag handle (edge of section) ───────────────────────────────────

function PaddingDragHandle({
  side,
  value,
  onChange,
}: {
  side: 'top' | 'right' | 'bottom' | 'left'
  value: number
  onChange: (v: number) => void
}) {
  const [dragging, setDragging] = useState(false)
  const startRef = useRef({ pos: 0, value: 0 })

  function handleMouseDown(e: React.MouseEvent) {
    e.stopPropagation()
    e.preventDefault()
    const startPos = side === 'top' || side === 'bottom' ? e.clientY : e.clientX
    startRef.current = { pos: startPos, value }
    setDragging(true)

    function handleMove(ev: MouseEvent) {
      const cur = side === 'top' || side === 'bottom' ? ev.clientY : ev.clientX
      let delta = cur - startRef.current.pos
      // Direction: positive delta means OUTWARD; we want OUTWARD = more padding
      if (side === 'top' || side === 'left') delta = -delta
      const next = Math.max(0, Math.min(120, Math.round(startRef.current.value + delta)))
      onChange(next)
    }
    function handleUp() {
      setDragging(false)
      document.removeEventListener('mousemove', handleMove)
      document.removeEventListener('mouseup', handleUp)
    }
    document.addEventListener('mousemove', handleMove)
    document.addEventListener('mouseup', handleUp)
  }

  const posClass = {
    top: 'top-0 left-0 right-0 h-2 cursor-ns-resize',
    bottom: 'bottom-0 left-0 right-0 h-2 cursor-ns-resize',
    left: 'top-0 bottom-0 left-0 w-2 cursor-ew-resize',
    right: 'top-0 bottom-0 right-0 w-2 cursor-ew-resize',
  }[side]
  const indicatorClass = {
    top: 'absolute inset-x-2 top-0 h-0.5',
    bottom: 'absolute inset-x-2 bottom-0 h-0.5',
    left: 'absolute inset-y-2 left-0 w-0.5',
    right: 'absolute inset-y-2 right-0 w-0.5',
  }[side]

  return (
    <div
      className={cn('absolute z-20 group/handle', posClass)}
      onMouseDown={handleMouseDown}
      onClick={(e) => e.stopPropagation()}
      title={`Drag to adjust ${side} padding`}
    >
      <span
        className={cn(
          indicatorClass,
          'transition-colors rounded-full',
          dragging ? 'bg-blue-500' : 'bg-transparent group-hover/handle:bg-blue-400',
        )}
      />
      {dragging && (
        <span className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-blue-500 text-white text-[10px] font-medium px-1.5 py-0.5 rounded shadow z-40 pointer-events-none whitespace-nowrap">
          {value}px
        </span>
      )}
    </div>
  )
}

// ─── Column gap drag handle (between columns) ────────────────────────────────

function ColumnGapDragHandle({
  value,
  onChange,
}: {
  value: number
  onChange: (v: number) => void
}) {
  const [dragging, setDragging] = useState(false)
  const startRef = useRef({ x: 0, value: 0 })

  function handleMouseDown(e: React.MouseEvent) {
    e.stopPropagation()
    e.preventDefault()
    startRef.current = { x: e.clientX, value }
    setDragging(true)

    function handleMove(ev: MouseEvent) {
      const delta = ev.clientX - startRef.current.x
      // Drag right -> increase gap; drag left -> decrease
      const next = Math.max(0, Math.min(80, Math.round(startRef.current.value + delta)))
      onChange(next)
    }
    function handleUp() {
      setDragging(false)
      document.removeEventListener('mousemove', handleMove)
      document.removeEventListener('mouseup', handleUp)
    }
    document.addEventListener('mousemove', handleMove)
    document.addEventListener('mouseup', handleUp)
  }

  return (
    <div
      className="relative shrink-0 cursor-ew-resize group/gap z-20"
      style={{ width: Math.max(8, value) }}
      onMouseDown={handleMouseDown}
      onClick={(e) => e.stopPropagation()}
      title="Drag right to widen gap, drag left to close"
    >
      <span
        className={cn(
          'absolute top-2 bottom-2 left-1/2 -translate-x-1/2 w-px transition-colors',
          dragging ? 'bg-blue-500 w-0.5' : 'bg-zinc-300 group-hover/gap:bg-blue-400 group-hover/gap:w-0.5',
        )}
      />
      {dragging && (
        <span className="absolute top-1 left-1/2 -translate-x-1/2 bg-blue-500 text-white text-[10px] font-medium px-1.5 py-0.5 rounded shadow z-40 pointer-events-none whitespace-nowrap">
          {value}px
        </span>
      )}
    </div>
  )
}

// ─── Sortable block wrapper + empty-column drop zone ─────────────────────────

/**
 * Wraps a single block in a `useSortable` node. The drag `listeners`/`attributes`
 * are handed to the child render-prop so they can be spread on the GRIP button
 * ONLY — never on the whole wrapper — otherwise the PointerSensor would hijack
 * contentEditable text editing + the inline block controls.
 */
function SortableBlock({
  block, sectionId, colIdx, children,
}: {
  block: EmailBlock
  sectionId: string
  colIdx: number
  children: (handleProps: { attributes: DraggableAttributes; listeners: DraggableSyntheticListeners }) => React.ReactNode
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: block.id,
    data: { type: 'block', blockId: block.id, sectionId, colIdx },
  })
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 }}
    >
      {children({ attributes, listeners })}
    </div>
  )
}

/**
 * Droppable zone for an EMPTY column. dnd-kit can't target a column with no
 * sortable items, so this registers a droppable at the SAME id string as the
 * column's `SortableContext` (`col:${sectionId}:${colIdx}`) — the handlers'
 * `resolveDropTarget` treats both identically.
 */
function EmptyColumnDropZone({ sectionId, colIdx }: { sectionId: string; colIdx: number }) {
  const { setNodeRef, isOver } = useDroppable({
    id: `col:${sectionId}:${colIdx}`,
    data: { type: 'column', sectionId, colIdx },
  })
  return (
    <div
      ref={setNodeRef}
      className={cn(
        'flex items-center justify-center min-h-16 border-2 border-dashed rounded mb-2 text-xs bg-zinc-50 transition-colors',
        isOver ? 'border-blue-500 text-blue-600 bg-blue-50' : 'border-zinc-400 text-zinc-600',
      )}
    >
      Drop a block here
    </div>
  )
}

// ─── Column editor ────────────────────────────────────────────────────────────

interface ColumnEditorProps {
  blocks: EmailBlock[]
  colIdx: number
  layout: number
  sectionId: string
  selectedBlockId: string | null
  onAddBlock: (type: string) => void
  onInsertReusable: (rb: ReusableBlock) => void
  onRemoveBlock: (blockId: string) => void
  onUpdateBlock: (blockId: string, updates: Partial<EmailBlock>) => void
  onSelectBlock: (blockId: string) => void
  reusableBlocks: ReusableBlock[]
  padding?: Partial<{ top: number; right: number; bottom: number; left: number }>
}

function ColumnEditor({
  blocks, colIdx, sectionId, selectedBlockId, onAddBlock, onInsertReusable,
  onRemoveBlock, onUpdateBlock, onSelectBlock, reusableBlocks, padding,
}: ColumnEditorProps) {
  const [showBlockMenu, setShowBlockMenu] = useState(false)
  const [showReusableMenu, setShowReusableMenu] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!showBlockMenu && !showReusableMenu) return
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowBlockMenu(false)
        setShowReusableMenu(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [showBlockMenu, showReusableMenu])

  const p = {
    top: padding?.top ?? 16,
    right: padding?.right ?? 24,
    bottom: padding?.bottom ?? 16,
    left: padding?.left ?? 24,
  }

  return (
    <div
      className="flex-1 min-w-0 group/col"
      style={{
        paddingTop: p.top,
        paddingRight: p.right,
        paddingBottom: p.bottom,
        paddingLeft: p.left,
      }}
    >
      {blocks.length === 0 && (
        <EmptyColumnDropZone sectionId={sectionId} colIdx={colIdx} />
      )}

      <SortableContext
        id={`col:${sectionId}:${colIdx}`}
        items={blocks.map((b) => b.id)}
        strategy={verticalListSortingStrategy}
      >
        {blocks.map((block) => (
          <SortableBlock key={block.id} block={block} sectionId={sectionId} colIdx={colIdx}>
            {({ attributes, listeners }) => (
              <BlockEditor
                block={block}
                isSelected={selectedBlockId === block.id}
                onSelect={() => onSelectBlock(block.id)}
                onUpdate={(u) => onUpdateBlock(block.id, u)}
                onRemove={() => onRemoveBlock(block.id)}
                dragHandleProps={{ attributes, listeners }}
              />
            )}
          </SortableBlock>
        ))}
      </SortableContext>

      {/* Add block controls */}
      <div
        ref={menuRef}
        className={cn('flex flex-wrap gap-1 mt-2 transition-opacity', blocks.length === 0 ? 'opacity-100' : 'opacity-0 group-hover/col:opacity-100')}
      >
        <div className="relative">
          <Button
            size="sm"
            variant="outline"
            className="h-6 text-[10px] gap-0.5 px-1.5 border-dashed border-zinc-400 text-zinc-600 bg-white hover:bg-zinc-50 hover:border-zinc-500"
            onClick={(e) => { e.stopPropagation(); setShowBlockMenu((p) => !p); setShowReusableMenu(false) }}
          >
            <Plus className="h-2.5 w-2.5" /> Block
          </Button>
          {showBlockMenu && (
            <div
              className="absolute z-20 top-full mt-1 left-0 bg-white border border-zinc-300 rounded shadow-md py-1 min-w-32"
              onClick={(e) => e.stopPropagation()}
            >
              {BLOCK_TYPES.map(({ type, label, icon }) => (
                <button
                  key={type}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-zinc-800 hover:bg-zinc-100 text-left"
                  onClick={() => { onAddBlock(type); setShowBlockMenu(false) }}
                >
                  {icon} {label}
                </button>
              ))}
            </div>
          )}
        </div>

        {reusableBlocks.length > 0 && (
          <div className="relative">
            <Button
              size="sm"
              variant="outline"
              className="h-6 text-[10px] gap-0.5 px-1.5 border-dashed border-zinc-400 text-zinc-600 bg-white hover:bg-zinc-50 hover:border-zinc-500"
              onClick={(e) => { e.stopPropagation(); setShowReusableMenu((p) => !p); setShowBlockMenu(false) }}
            >
              <Bookmark className="h-2.5 w-2.5" /> Insert
            </Button>
            {showReusableMenu && (
              <div
                className="absolute z-20 top-full mt-1 left-0 bg-white border border-zinc-300 rounded shadow-md py-1 min-w-40"
                onClick={(e) => e.stopPropagation()}
              >
                {reusableBlocks.map((rb) => (
                  <button
                    key={rb.id}
                    className="w-full flex flex-col px-3 py-1.5 text-xs text-zinc-800 hover:bg-zinc-100 text-left"
                    onClick={() => { onInsertReusable(rb); setShowReusableMenu(false) }}
                  >
                    <span>{rb.name}</span>
                    <span className="text-zinc-600 text-[10px]">{rb.block_type}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Block editor ─────────────────────────────────────────────────────────────

interface BlockEditorProps {
  block: EmailBlock
  isSelected: boolean
  onSelect: () => void
  onUpdate: (updates: Partial<EmailBlock>) => void
  onRemove: () => void
  dragHandleProps?: { attributes: DraggableAttributes; listeners: DraggableSyntheticListeners }
}

function BlockEditor({ block, isSelected, onSelect, onUpdate, onRemove, dragHandleProps }: BlockEditorProps) {
  return (
    <div
      className={cn(
        'group/block relative mb-2 border-2 rounded transition-colors cursor-pointer',
        isSelected ? 'border-blue-500' : 'border-transparent hover:border-blue-400',
      )}
      onClick={(e) => { e.stopPropagation(); onSelect() }}
    >
      {/* Block controls */}
      <div className="absolute top-0.5 right-0.5 flex items-center gap-0.5 opacity-0 group-hover/block:opacity-100 transition-opacity z-10">
        {dragHandleProps && (
          // Drag listeners live on THIS grip button ONLY — spreading them on the
          // whole wrapper would let the PointerSensor hijack text editing.
          <button
            {...dragHandleProps.attributes}
            {...dragHandleProps.listeners}
            className="h-5 w-5 flex items-center justify-center rounded bg-white border border-zinc-400 text-zinc-700 hover:text-zinc-900 hover:bg-zinc-100 shadow-sm cursor-grab active:cursor-grabbing"
            onClick={(e) => e.stopPropagation()}
            title="Drag to move block"
          >
            <GripVertical className="h-2.5 w-2.5" />
          </button>
        )}
        <button
          className="h-5 w-5 flex items-center justify-center rounded bg-white border border-zinc-400 text-zinc-700 hover:text-white hover:bg-red-500 hover:border-red-500 shadow-sm"
          onClick={(e) => { e.stopPropagation(); onRemove() }}
          title="Remove block"
        >
          <X className="h-2.5 w-2.5" />
        </button>
      </div>

      {/* Block content preview + editor */}
      <div className="p-1">
        <BlockPreviewAndEdit block={block} onUpdate={onUpdate} isSelected={isSelected} />
      </div>
    </div>
  )
}

// ─── Block preview + inline editing ──────────────────────────────────────────

interface BlockPreviewAndEditProps {
  block: EmailBlock
  onUpdate: (updates: Partial<EmailBlock>) => void
  isSelected: boolean
}

function BlockPreviewAndEdit({ block, onUpdate, isSelected }: BlockPreviewAndEditProps) {
  switch (block.blockType) {
    case 'text':
      return <TextBlockEditor block={block} onUpdate={onUpdate} isSelected={isSelected} />
    case 'heading':
      return <HeadingBlockEditor block={block} onUpdate={onUpdate} isSelected={isSelected} />
    case 'image':
      return <ImageBlockEditor block={block} onUpdate={onUpdate} isSelected={isSelected} />
    case 'button':
      return <ButtonBlockEditor block={block} onUpdate={onUpdate} isSelected={isSelected} />
    case 'divider':
      return <DividerBlockEditor block={block} onUpdate={onUpdate} />
    case 'spacer':
      return <SpacerBlockEditor block={block} onUpdate={onUpdate} />
    case 'html':
      return <HtmlBlockEditor block={block} onUpdate={onUpdate} isSelected={isSelected} />
    default:
      return <div className="text-xs text-zinc-700 p-2">Unknown block</div>
  }
}

function TextBlockEditor({ block, onUpdate, isSelected }: { block: TextBlock; onUpdate: (u: Partial<TextBlock>) => void; isSelected: boolean }) {
  return (
    <div>
      <div
        contentEditable
        suppressContentEditableWarning
        className="text-sm outline-none min-h-[1.5em]"
        style={{ color: block.color ?? '#333', textAlign: block.align ?? 'left', fontSize: `${block.fontSize ?? 15}px` }}
        onBlur={(e) => onUpdate({ content: e.currentTarget.innerHTML })}
        dangerouslySetInnerHTML={{ __html: block.content }}
      />
      {isSelected && (
        <div className="mt-2 flex flex-wrap gap-2 border-t border-zinc-300 pt-2" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center gap-1">
            <Label className="text-[10px] text-zinc-700 font-medium">Color</Label>
            <input type="color" value={block.color ?? '#333333'} onChange={(e) => onUpdate({ color: e.target.value })} className="w-5 h-4 rounded border border-zinc-300 cursor-pointer" />
          </div>
          <div className="flex items-center gap-1">
            <Label className="text-[10px] text-zinc-700 font-medium">Size</Label>
            <input type="number" min={10} max={48} value={block.fontSize ?? 15} onChange={(e) => onUpdate({ fontSize: Number(e.target.value) })} className="w-10 h-4 text-[10px] text-zinc-800 border border-zinc-400 bg-white rounded px-1" />
          </div>
          <div className="flex items-center gap-1">
            <Label className="text-[10px] text-zinc-700 font-medium">Align</Label>
            <Select value={block.align ?? 'left'} onValueChange={(v) => onUpdate({ align: v as TextBlock['align'] })}>
              <SelectTrigger className="h-5 text-[10px] w-16 text-zinc-800 border-zinc-400 bg-white"><SelectValue /></SelectTrigger>
              <SelectContent>
                {['left', 'center', 'right'].map((a) => <SelectItem key={a} value={a} className="text-[10px]">{a}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
      )}
    </div>
  )
}

function HeadingBlockEditor({ block, onUpdate, isSelected }: { block: HeadingBlock; onUpdate: (u: Partial<HeadingBlock>) => void; isSelected: boolean }) {
  const sizes: Record<number, number> = { 1: 32, 2: 24, 3: 20 }
  const level = block.level ?? 2
  return (
    <div>
      <div
        contentEditable
        suppressContentEditableWarning
        className="font-bold outline-none min-h-[1.5em]"
        style={{ color: block.color ?? '#111', textAlign: block.align ?? 'left', fontSize: `${sizes[level] ?? 24}px` }}
        onBlur={(e) => onUpdate({ content: e.currentTarget.innerHTML })}
        dangerouslySetInnerHTML={{ __html: block.content }}
      />
      {isSelected && (
        <div className="mt-2 flex flex-wrap gap-2 border-t border-zinc-300 pt-2" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center gap-1">
            <Label className="text-[10px] text-zinc-700 font-medium">Level</Label>
            <Select value={String(block.level ?? 2)} onValueChange={(v) => onUpdate({ level: Number(v) as HeadingBlock['level'] })}>
              <SelectTrigger className="h-5 text-[10px] w-12 text-zinc-800 border-zinc-400 bg-white"><SelectValue /></SelectTrigger>
              <SelectContent>
                {[1, 2, 3].map((l) => <SelectItem key={l} value={String(l)} className="text-[10px]">H{l}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-1">
            <Label className="text-[10px] text-zinc-700 font-medium">Color</Label>
            <input type="color" value={block.color ?? '#111111'} onChange={(e) => onUpdate({ color: e.target.value })} className="w-5 h-4 rounded border border-zinc-300 cursor-pointer" />
          </div>
          <div className="flex items-center gap-1">
            <Label className="text-[10px] text-zinc-700 font-medium">Align</Label>
            <Select value={block.align ?? 'left'} onValueChange={(v) => onUpdate({ align: v as HeadingBlock['align'] })}>
              <SelectTrigger className="h-5 text-[10px] w-16 text-zinc-800 border-zinc-400 bg-white"><SelectValue /></SelectTrigger>
              <SelectContent>
                {['left', 'center', 'right'].map((a) => <SelectItem key={a} value={a} className="text-[10px]">{a}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
      )}
    </div>
  )
}

function ImageBlockEditor({ block, onUpdate, isSelected }: { block: ImageBlock; onUpdate: (u: Partial<ImageBlock>) => void; isSelected: boolean }) {
  return (
    <div>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={block.src}
        alt={block.alt ?? ''}
        style={{ maxWidth: '100%', height: 'auto', display: 'block', margin: '0 auto' }}
      />
      {isSelected && (
        <div className="mt-2 space-y-1.5 border-t border-zinc-300 pt-2" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center gap-1">
            <Label className="text-[10px] text-zinc-700 font-medium w-8 shrink-0">Src</Label>
            <input type="text" value={block.src} onChange={(e) => onUpdate({ src: e.target.value })} className="flex-1 h-5 text-[10px] text-zinc-800 border border-zinc-400 bg-white rounded px-1.5 min-w-0" placeholder="Image URL" />
          </div>
          <div className="flex items-center gap-1">
            <Label className="text-[10px] text-zinc-700 font-medium w-8 shrink-0">Alt</Label>
            <input type="text" value={block.alt ?? ''} onChange={(e) => onUpdate({ alt: e.target.value })} className="flex-1 h-5 text-[10px] text-zinc-800 border border-zinc-400 bg-white rounded px-1.5 min-w-0" placeholder="Alt text" />
          </div>
          <div className="flex items-center gap-1">
            <Label className="text-[10px] text-zinc-700 font-medium w-8 shrink-0">Link</Label>
            <input type="text" value={block.link ?? ''} onChange={(e) => onUpdate({ link: e.target.value })} className="flex-1 h-5 text-[10px] text-zinc-800 border border-zinc-400 bg-white rounded px-1.5 min-w-0" placeholder="Click URL" />
          </div>
        </div>
      )}
    </div>
  )
}

function ButtonBlockEditor({ block, onUpdate, isSelected }: { block: ButtonBlock; onUpdate: (u: Partial<ButtonBlock>) => void; isSelected: boolean }) {
  return (
    <div>
      <div className="flex justify-center">
        <span
          style={{
            display: 'inline-block',
            backgroundColor: block.backgroundColor ?? '#000',
            color: block.textColor ?? '#fff',
            borderRadius: `${block.borderRadius ?? 4}px`,
            padding: '10px 20px',
            fontSize: '14px',
            fontWeight: 600,
          }}
        >
          {block.label}
        </span>
      </div>
      {isSelected && (
        <div className="mt-2 space-y-1.5 border-t border-zinc-300 pt-2" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center gap-1">
            <Label className="text-[10px] text-zinc-700 font-medium w-10 shrink-0">Label</Label>
            <input type="text" value={block.label} onChange={(e) => onUpdate({ label: e.target.value })} className="flex-1 h-5 text-[10px] text-zinc-800 border border-zinc-400 bg-white rounded px-1.5 min-w-0" />
          </div>
          <div className="flex items-center gap-1">
            <Label className="text-[10px] text-zinc-700 font-medium w-10 shrink-0">URL</Label>
            <input type="text" value={block.href} onChange={(e) => onUpdate({ href: e.target.value })} className="flex-1 h-5 text-[10px] text-zinc-800 border border-zinc-400 bg-white rounded px-1.5 min-w-0" />
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1">
              <Label className="text-[10px] text-zinc-700 font-medium">BG</Label>
              <input type="color" value={block.backgroundColor ?? '#000000'} onChange={(e) => onUpdate({ backgroundColor: e.target.value })} className="w-5 h-4 rounded border border-zinc-300 cursor-pointer" />
            </div>
            <div className="flex items-center gap-1">
              <Label className="text-[10px] text-zinc-700 font-medium">Text</Label>
              <input type="color" value={block.textColor ?? '#ffffff'} onChange={(e) => onUpdate({ textColor: e.target.value })} className="w-5 h-4 rounded border border-zinc-300 cursor-pointer" />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function DividerBlockEditor({ block, onUpdate }: { block: DividerBlock; onUpdate: (u: Partial<DividerBlock>) => void }) {
  return (
    <div className="py-2">
      <hr style={{ border: 0, borderTop: `${block.thickness ?? 1}px solid ${block.color ?? '#e5e5e5'}`, margin: 0 }} />
    </div>
  )
}

function SpacerBlockEditor({ block, onUpdate }: { block: SpacerBlock; onUpdate: (u: Partial<SpacerBlock>) => void }) {
  return (
    <div className="flex items-center gap-2 px-1">
      <div className="flex-1 border-t border-dashed border-zinc-400" />
      <span className="text-[10px] text-zinc-700 font-medium shrink-0">{block.height ?? 24}px space</span>
      <div className="flex-1 border-t border-dashed border-zinc-400" />
    </div>
  )
}

function HtmlBlockEditor({ block, onUpdate, isSelected }: { block: HtmlBlock; onUpdate: (u: Partial<HtmlBlock>) => void; isSelected: boolean }) {
  return (
    <div>
      {isSelected ? (
        <textarea
          value={block.content}
          onChange={(e) => onUpdate({ content: e.target.value })}
          onClick={(e) => e.stopPropagation()}
          className="w-full min-h-24 text-xs font-mono text-zinc-800 border border-zinc-400 bg-zinc-50 rounded p-2 resize-y"
          placeholder="<p>Custom email-safe HTML…</p>"
          spellCheck={false}
        />
      ) : (
        <div
          className="text-xs text-zinc-800 [&_*]:max-w-full"
          dangerouslySetInnerHTML={{ __html: block.content || '<span class="text-zinc-400 italic">Empty HTML block — click to edit</span>' }}
        />
      )}
    </div>
  )
}
