'use client'

import { useState, useTransition, useCallback, useId } from 'react'
import { toast } from 'sonner'
import {
  Save, Eye, EyeOff, Plus, Trash2, Loader2, GripVertical,
  Type, Image, MousePointerClick, Minus, AlignJustify, Bookmark,
  ChevronDown, ChevronUp, X, PanelRightOpen, PanelRightClose,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from '@/components/ui/sheet'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'

import {
  DndContext, closestCenter, KeyboardSensor, PointerSensor,
  useSensor, useSensors, DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy,
  useSortable, arrayMove,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

import type {
  EmailDocument, EmailSection, EmailBlock,
  TextBlock, HeadingBlock, ImageBlock, ButtonBlock, DividerBlock, SpacerBlock,
} from '@/lib/email/render-template'
import { renderTemplate, emptyDocument, BLOCK_DEFAULTS } from '@/lib/email/render-template'
import { saveTemplate, saveReusableBlock, deleteReusableBlock } from '../actions'
import type { EmailTemplateBuilderRow, ReusableBlock } from '../actions'

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

function normalizeDocument(raw: unknown): EmailDocument {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const doc = raw as Partial<EmailDocument>
    if (Array.isArray(doc.sections)) return doc as EmailDocument
  }
  return emptyDocument()
}

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
  const [selectedBlockPath, setSelectedBlockPath] = useState<{ sectionId: string; colIdx: number; blockIdx: number } | null>(null)

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
    const block = { ...BLOCK_DEFAULTS[blockType] } as EmailBlock
    setDoc((prev) => ({
      ...prev,
      sections: prev.sections.map((s) => {
        if (s.id !== sectionId) return s
        const cols = s.columns.map((col, ci) => ci === colIdx ? [...col, block] : col)
        return { ...s, columns: cols }
      }),
    }))
    const section = doc.sections.find((s) => s.id === sectionId)
    if (section) {
      setSelectedBlockPath({ sectionId, colIdx, blockIdx: (section.columns[colIdx]?.length ?? 0) })
    }
  }, [doc.sections])

  const insertReusableBlock = useCallback((sectionId: string, colIdx: number, rb: ReusableBlock) => {
    const blocks = (rb.document as { blocks?: EmailBlock[] }).blocks ?? []
    if (!blocks.length) return
    setDoc((prev) => ({
      ...prev,
      sections: prev.sections.map((s) => {
        if (s.id !== sectionId) return s
        const cols = s.columns.map((col, ci) => ci === colIdx ? [...col, ...blocks] : col)
        return { ...s, columns: cols }
      }),
    }))
  }, [])

  const removeBlock = useCallback((sectionId: string, colIdx: number, blockIdx: number) => {
    setDoc((prev) => ({
      ...prev,
      sections: prev.sections.map((s) => {
        if (s.id !== sectionId) return s
        const cols = s.columns.map((col, ci) => ci === colIdx ? col.filter((_, bi) => bi !== blockIdx) : col)
        return { ...s, columns: cols }
      }),
    }))
    setSelectedBlockPath(null)
  }, [])

  const updateBlock = useCallback((sectionId: string, colIdx: number, blockIdx: number, updates: Partial<EmailBlock>) => {
    setDoc((prev) => ({
      ...prev,
      sections: prev.sections.map((s) => {
        if (s.id !== sectionId) return s
        const cols = s.columns.map((col, ci) => {
          if (ci !== colIdx) return col
          return col.map((b, bi) => bi !== blockIdx ? b : { ...b, ...updates } as EmailBlock)
        })
        return { ...s, columns: cols }
      }),
    }))
  }, [])

  const handleSectionDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    setDoc((prev) => {
      const oldIndex = prev.sections.findIndex((s) => s.id === active.id)
      const newIndex = prev.sections.findIndex((s) => s.id === over.id)
      return { ...prev, sections: arrayMove(prev.sections, oldIndex, newIndex) }
    })
  }, [])

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

  const selectedBlock = selectedBlockPath
    ? (() => {
        const s = doc.sections.find((s) => s.id === selectedBlockPath.sectionId)
        return s?.columns[selectedBlockPath.colIdx]?.[selectedBlockPath.blockIdx] ?? null
      })()
    : null

  return (
    <div className="flex h-full overflow-hidden">
      {/* ── Canvas ──────────────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Toolbar */}
        <div className="flex items-center gap-2 px-4 py-2 border-b border-border bg-card/80 shrink-0 flex-wrap gap-y-1">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="h-7 text-sm max-w-48"
            placeholder="Template name"
          />

          <div className="flex items-center gap-1 ml-auto">
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
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleSectionDragEnd}>
                <SortableContext items={doc.sections.map((s) => s.id)} strategy={verticalListSortingStrategy}>
                  {doc.sections.map((section) => (
                    <SortableSection
                      key={section.id}
                      section={section}
                      isSelected={selectedSectionId === section.id}
                      selectedBlockPath={selectedBlockPath}
                      onSelect={() => setSelectedSectionId(section.id)}
                      onRemove={() => removeSection(section.id)}
                      onUpdate={(u) => updateSection(section.id, u)}
                      onAddBlock={(colIdx, type) => addBlock(section.id, colIdx, type)}
                      onInsertReusable={(colIdx, rb) => insertReusableBlock(section.id, colIdx, rb)}
                      onRemoveBlock={(colIdx, blockIdx) => removeBlock(section.id, colIdx, blockIdx)}
                      onUpdateBlock={(colIdx, blockIdx, u) => updateBlock(section.id, colIdx, blockIdx, u)}
                      onSelectBlock={(colIdx, blockIdx) =>
                        setSelectedBlockPath({ sectionId: section.id, colIdx, blockIdx })}
                      onSaveAsReusable={() => openSaveBlock(section.id)}
                      reusableBlocks={reusableBlocks}
                    />
                  ))}
                </SortableContext>
              </DndContext>

              {/* Add section buttons */}
              <div className="px-4 py-4 flex items-center gap-2 flex-wrap border-t border-dashed border-zinc-200">
                <span className="text-xs text-zinc-400 mr-1">Add section:</span>
                {([1, 2, 3] as const).map((layout) => (
                  <Button
                    key={layout}
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs gap-1"
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

      {/* ── Reusable blocks panel ────────────────────────────────────────────── */}
      {activePanel === 'reusable' && (
        <div className="w-64 border-l border-border flex flex-col shrink-0 overflow-hidden">
          <div className="flex items-center justify-between px-3 py-2 border-b border-border">
            <span className="text-xs font-medium">Reusable Blocks</span>
            <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => setActivePanel(null)}>
              <X className="h-3 w-3" />
            </Button>
          </div>
          <ScrollArea className="flex-1">
            <div className="p-3 space-y-2">
              {reusableBlocks.length === 0 && (
                <p className="text-xs text-muted-foreground text-center py-4">
                  No reusable blocks yet. Save a section as a reusable block to see it here.
                </p>
              )}
              {reusableBlocks.map((rb) => (
                <div key={rb.id} className="rounded border border-border p-2 space-y-1">
                  <div className="flex items-start justify-between gap-1">
                    <div>
                      <p className="text-xs font-medium leading-tight">{rb.name}</p>
                      <Badge variant="outline" className="text-[10px] mt-0.5">{rb.block_type}</Badge>
                    </div>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-5 w-5 text-destructive hover:text-destructive shrink-0"
                      onClick={() => handleDeleteReusable(rb.id)}
                    >
                      <Trash2 className="h-2.5 w-2.5" />
                    </Button>
                  </div>
                  <p className="text-[10px] text-muted-foreground">
                    Click a section&apos;s &quot;Insert&quot; button to add
                  </p>
                </div>
              ))}
            </div>
          </ScrollArea>
        </div>
      )}

      {/* ── Preview sheet ────────────────────────────────────────────────────── */}
      <Sheet open={previewOpen} onOpenChange={setPreviewOpen}>
        <SheetContent side="right" className="w-full sm:max-w-4xl p-0 flex flex-col">
          <div className="px-6 py-4 border-b border-border shrink-0">
            <h2 className="text-sm font-medium">HTML Preview — {name}</h2>
          </div>
          <div className="flex-1 overflow-hidden">
            <iframe
              srcDoc={previewHtml}
              className="w-full h-full border-0"
              title="Email preview"
              sandbox="allow-same-origin"
            />
          </div>
        </SheetContent>
      </Sheet>

      {/* ── Save as reusable sheet ───────────────────────────────────────────── */}
      <Sheet open={saveBlockOpen} onOpenChange={setSaveBlockOpen}>
        <SheetContent side="right" className="w-full sm:max-w-sm">
          <SheetHeader className="mb-4">
            <SheetTitle>Save as Reusable Block</SheetTitle>
            <SheetDescription>
              Save this section&apos;s blocks as a reusable block that can be inserted into any template.
            </SheetDescription>
          </SheetHeader>
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
        </SheetContent>
      </Sheet>
    </div>
  )
}

// ─── Sortable section ─────────────────────────────────────────────────────────

interface SortableSectionProps {
  section: EmailSection
  isSelected: boolean
  selectedBlockPath: { sectionId: string; colIdx: number; blockIdx: number } | null
  onSelect: () => void
  onRemove: () => void
  onUpdate: (updates: Partial<EmailSection>) => void
  onAddBlock: (colIdx: number, blockType: string) => void
  onInsertReusable: (colIdx: number, rb: ReusableBlock) => void
  onRemoveBlock: (colIdx: number, blockIdx: number) => void
  onUpdateBlock: (colIdx: number, blockIdx: number, updates: Partial<EmailBlock>) => void
  onSelectBlock: (colIdx: number, blockIdx: number) => void
  onSaveAsReusable: () => void
  reusableBlocks: ReusableBlock[]
}

function SortableSection({
  section, isSelected, selectedBlockPath, onSelect, onRemove, onUpdate,
  onAddBlock, onInsertReusable, onRemoveBlock, onUpdateBlock, onSelectBlock,
  onSaveAsReusable, reusableBlocks,
}: SortableSectionProps) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: section.id })
  const style = { transform: CSS.Transform.toString(transform), transition }
  const [showSettings, setShowSettings] = useState(false)

  return (
    <div
      ref={setNodeRef}
      style={{ ...style, backgroundColor: section.backgroundColor ?? '#ffffff' }}
      className={cn('group relative border-2 transition-colors', isSelected ? 'border-blue-400/60' : 'border-transparent hover:border-zinc-200')}
      onClick={onSelect}
    >
      {/* Section controls */}
      <div className="absolute top-1 right-1 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity z-10">
        <button
          {...attributes}
          {...listeners}
          className="cursor-grab active:cursor-grabbing h-6 w-6 flex items-center justify-center rounded text-zinc-400 hover:text-zinc-600 hover:bg-zinc-100"
          title="Drag to reorder"
        >
          <GripVertical className="h-3 w-3" />
        </button>
        <button
          className="h-6 w-6 flex items-center justify-center rounded text-zinc-400 hover:text-zinc-600 hover:bg-zinc-100"
          onClick={(e) => { e.stopPropagation(); setShowSettings((p) => !p) }}
          title="Section settings"
        >
          {showSettings ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        </button>
        <button
          className="h-6 w-6 flex items-center justify-center rounded text-zinc-400 hover:text-blue-500 hover:bg-zinc-100"
          onClick={(e) => { e.stopPropagation(); onSaveAsReusable() }}
          title="Save as reusable block"
        >
          <Bookmark className="h-3 w-3" />
        </button>
        <button
          className="h-6 w-6 flex items-center justify-center rounded text-zinc-400 hover:text-red-500 hover:bg-zinc-100"
          onClick={(e) => { e.stopPropagation(); onRemove() }}
          title="Remove section"
        >
          <Trash2 className="h-3 w-3" />
        </button>
      </div>

      {/* Section settings panel */}
      {showSettings && (
        <div
          className="px-3 pt-2 pb-1 bg-zinc-50 border-b border-zinc-200 flex flex-wrap gap-3"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center gap-1.5">
            <Label className="text-[10px] text-zinc-500">BG Color</Label>
            <input
              type="color"
              value={section.backgroundColor ?? '#ffffff'}
              onChange={(e) => onUpdate({ backgroundColor: e.target.value })}
              className="w-6 h-5 rounded border-0 cursor-pointer"
            />
          </div>
          <div className="flex items-center gap-1.5">
            <Label className="text-[10px] text-zinc-500">Padding</Label>
            {(['top', 'right', 'bottom', 'left'] as const).map((side) => (
              <input
                key={side}
                type="number"
                min={0}
                max={80}
                value={section.padding?.[side] ?? 16}
                onChange={(e) => onUpdate({ padding: { ...section.padding, [side]: Number(e.target.value) } })}
                className="w-10 h-5 text-[10px] border border-zinc-200 rounded px-1"
                title={`${side} padding`}
              />
            ))}
          </div>
        </div>
      )}

      {/* Columns */}
      <div className={cn('flex', section.layout > 1 ? 'divide-x divide-zinc-100' : '')}>
        {Array.from({ length: section.layout }).map((_, colIdx) => (
          <ColumnEditor
            key={colIdx}
            blocks={section.columns[colIdx] ?? []}
            colIdx={colIdx}
            layout={section.layout}
            sectionId={section.id}
            selectedBlockPath={selectedBlockPath}
            onAddBlock={(type) => onAddBlock(colIdx, type)}
            onInsertReusable={(rb) => onInsertReusable(colIdx, rb)}
            onRemoveBlock={(blockIdx) => onRemoveBlock(colIdx, blockIdx)}
            onUpdateBlock={(blockIdx, updates) => onUpdateBlock(colIdx, blockIdx, updates)}
            onSelectBlock={(blockIdx) => onSelectBlock(colIdx, blockIdx)}
            reusableBlocks={reusableBlocks}
            padding={section.padding}
          />
        ))}
      </div>
    </div>
  )
}

// ─── Column editor ────────────────────────────────────────────────────────────

interface ColumnEditorProps {
  blocks: EmailBlock[]
  colIdx: number
  layout: number
  sectionId: string
  selectedBlockPath: { sectionId: string; colIdx: number; blockIdx: number } | null
  onAddBlock: (type: string) => void
  onInsertReusable: (rb: ReusableBlock) => void
  onRemoveBlock: (blockIdx: number) => void
  onUpdateBlock: (blockIdx: number, updates: Partial<EmailBlock>) => void
  onSelectBlock: (blockIdx: number) => void
  reusableBlocks: ReusableBlock[]
  padding?: Partial<{ top: number; right: number; bottom: number; left: number }>
}

function ColumnEditor({
  blocks, colIdx, layout, sectionId, selectedBlockPath, onAddBlock, onInsertReusable,
  onRemoveBlock, onUpdateBlock, onSelectBlock, reusableBlocks, padding,
}: ColumnEditorProps) {
  const [showBlockMenu, setShowBlockMenu] = useState(false)
  const [showReusableMenu, setShowReusableMenu] = useState(false)

  const p = {
    top: padding?.top ?? 16,
    right: padding?.right ?? 24,
    bottom: padding?.bottom ?? 16,
    left: padding?.left ?? 24,
  }

  const BLOCK_TYPES: { type: string; label: string; icon: React.ReactNode }[] = [
    { type: 'heading', label: 'Heading', icon: <Type className="h-3 w-3" /> },
    { type: 'text', label: 'Text', icon: <AlignJustify className="h-3 w-3" /> },
    { type: 'image', label: 'Image', icon: <Image className="h-3 w-3" /> },
    { type: 'button', label: 'Button', icon: <MousePointerClick className="h-3 w-3" /> },
    { type: 'divider', label: 'Divider', icon: <Minus className="h-3 w-3" /> },
    { type: 'spacer', label: 'Spacer', icon: <AlignJustify className="h-3 w-3" /> },
  ]

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
      {blocks.map((block, blockIdx) => (
        <BlockEditor
          key={blockIdx}
          block={block}
          isSelected={
            selectedBlockPath?.sectionId === sectionId &&
            selectedBlockPath.colIdx === colIdx &&
            selectedBlockPath.blockIdx === blockIdx
          }
          onSelect={() => onSelectBlock(blockIdx)}
          onUpdate={(u) => onUpdateBlock(blockIdx, u)}
          onRemove={() => onRemoveBlock(blockIdx)}
        />
      ))}

      {/* Add block controls */}
      <div className="flex flex-wrap gap-1 mt-2 opacity-0 group-hover/col:opacity-100 transition-opacity">
        <div className="relative">
          <Button
            size="sm"
            variant="outline"
            className="h-6 text-[10px] gap-0.5 px-1.5 border-dashed"
            onClick={(e) => { e.stopPropagation(); setShowBlockMenu((p) => !p); setShowReusableMenu(false) }}
          >
            <Plus className="h-2.5 w-2.5" /> Block
          </Button>
          {showBlockMenu && (
            <div
              className="absolute z-20 top-full mt-1 left-0 bg-white border border-zinc-200 rounded shadow-md py-1 min-w-32"
              onClick={(e) => e.stopPropagation()}
            >
              {BLOCK_TYPES.map(({ type, label, icon }) => (
                <button
                  key={type}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-zinc-50 text-left"
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
              className="h-6 text-[10px] gap-0.5 px-1.5 border-dashed"
              onClick={(e) => { e.stopPropagation(); setShowReusableMenu((p) => !p); setShowBlockMenu(false) }}
            >
              <Bookmark className="h-2.5 w-2.5" /> Insert
            </Button>
            {showReusableMenu && (
              <div
                className="absolute z-20 top-full mt-1 left-0 bg-white border border-zinc-200 rounded shadow-md py-1 min-w-40"
                onClick={(e) => e.stopPropagation()}
              >
                {reusableBlocks.map((rb) => (
                  <button
                    key={rb.id}
                    className="w-full flex flex-col px-3 py-1.5 text-xs hover:bg-zinc-50 text-left"
                    onClick={() => { onInsertReusable(rb); setShowReusableMenu(false) }}
                  >
                    <span>{rb.name}</span>
                    <span className="text-zinc-400 text-[10px]">{rb.block_type}</span>
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
}

function BlockEditor({ block, isSelected, onSelect, onUpdate, onRemove }: BlockEditorProps) {
  return (
    <div
      className={cn(
        'group/block relative mb-2 border-2 rounded transition-colors cursor-pointer',
        isSelected ? 'border-blue-400' : 'border-transparent hover:border-blue-200',
      )}
      onClick={(e) => { e.stopPropagation(); onSelect() }}
    >
      {/* Block controls */}
      <div className="absolute top-0.5 right-0.5 flex items-center gap-0.5 opacity-0 group-hover/block:opacity-100 transition-opacity z-10">
        <button
          className="h-5 w-5 flex items-center justify-center rounded bg-white border border-zinc-200 text-zinc-400 hover:text-red-500"
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
    default:
      return <div className="text-xs text-zinc-400 p-2">Unknown block</div>
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
        <div className="mt-2 flex flex-wrap gap-2 border-t border-zinc-100 pt-2" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center gap-1">
            <Label className="text-[10px] text-zinc-500">Color</Label>
            <input type="color" value={block.color ?? '#333333'} onChange={(e) => onUpdate({ color: e.target.value })} className="w-5 h-4 rounded border-0 cursor-pointer" />
          </div>
          <div className="flex items-center gap-1">
            <Label className="text-[10px] text-zinc-500">Size</Label>
            <input type="number" min={10} max={48} value={block.fontSize ?? 15} onChange={(e) => onUpdate({ fontSize: Number(e.target.value) })} className="w-10 h-4 text-[10px] border border-zinc-200 rounded px-1" />
          </div>
          <div className="flex items-center gap-1">
            <Label className="text-[10px] text-zinc-500">Align</Label>
            <Select value={block.align ?? 'left'} onValueChange={(v) => onUpdate({ align: v as TextBlock['align'] })}>
              <SelectTrigger className="h-5 text-[10px] w-16"><SelectValue /></SelectTrigger>
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
        <div className="mt-2 flex flex-wrap gap-2 border-t border-zinc-100 pt-2" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center gap-1">
            <Label className="text-[10px] text-zinc-500">Level</Label>
            <Select value={String(block.level ?? 2)} onValueChange={(v) => onUpdate({ level: Number(v) as HeadingBlock['level'] })}>
              <SelectTrigger className="h-5 text-[10px] w-12"><SelectValue /></SelectTrigger>
              <SelectContent>
                {[1, 2, 3].map((l) => <SelectItem key={l} value={String(l)} className="text-[10px]">H{l}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-1">
            <Label className="text-[10px] text-zinc-500">Color</Label>
            <input type="color" value={block.color ?? '#111111'} onChange={(e) => onUpdate({ color: e.target.value })} className="w-5 h-4 rounded border-0 cursor-pointer" />
          </div>
          <div className="flex items-center gap-1">
            <Label className="text-[10px] text-zinc-500">Align</Label>
            <Select value={block.align ?? 'left'} onValueChange={(v) => onUpdate({ align: v as HeadingBlock['align'] })}>
              <SelectTrigger className="h-5 text-[10px] w-16"><SelectValue /></SelectTrigger>
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
        <div className="mt-2 space-y-1.5 border-t border-zinc-100 pt-2" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center gap-1">
            <Label className="text-[10px] text-zinc-500 w-8 shrink-0">Src</Label>
            <input type="text" value={block.src} onChange={(e) => onUpdate({ src: e.target.value })} className="flex-1 h-5 text-[10px] border border-zinc-200 rounded px-1.5 min-w-0" placeholder="Image URL" />
          </div>
          <div className="flex items-center gap-1">
            <Label className="text-[10px] text-zinc-500 w-8 shrink-0">Alt</Label>
            <input type="text" value={block.alt ?? ''} onChange={(e) => onUpdate({ alt: e.target.value })} className="flex-1 h-5 text-[10px] border border-zinc-200 rounded px-1.5 min-w-0" placeholder="Alt text" />
          </div>
          <div className="flex items-center gap-1">
            <Label className="text-[10px] text-zinc-500 w-8 shrink-0">Link</Label>
            <input type="text" value={block.link ?? ''} onChange={(e) => onUpdate({ link: e.target.value })} className="flex-1 h-5 text-[10px] border border-zinc-200 rounded px-1.5 min-w-0" placeholder="Click URL" />
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
        <div className="mt-2 space-y-1.5 border-t border-zinc-100 pt-2" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center gap-1">
            <Label className="text-[10px] text-zinc-500 w-10 shrink-0">Label</Label>
            <input type="text" value={block.label} onChange={(e) => onUpdate({ label: e.target.value })} className="flex-1 h-5 text-[10px] border border-zinc-200 rounded px-1.5 min-w-0" />
          </div>
          <div className="flex items-center gap-1">
            <Label className="text-[10px] text-zinc-500 w-10 shrink-0">URL</Label>
            <input type="text" value={block.href} onChange={(e) => onUpdate({ href: e.target.value })} className="flex-1 h-5 text-[10px] border border-zinc-200 rounded px-1.5 min-w-0" />
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1">
              <Label className="text-[10px] text-zinc-500">BG</Label>
              <input type="color" value={block.backgroundColor ?? '#000000'} onChange={(e) => onUpdate({ backgroundColor: e.target.value })} className="w-5 h-4 rounded border-0 cursor-pointer" />
            </div>
            <div className="flex items-center gap-1">
              <Label className="text-[10px] text-zinc-500">Text</Label>
              <input type="color" value={block.textColor ?? '#ffffff'} onChange={(e) => onUpdate({ textColor: e.target.value })} className="w-5 h-4 rounded border-0 cursor-pointer" />
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
      <div className="flex-1 border-t border-dashed border-zinc-200" />
      <span className="text-[10px] text-zinc-400 shrink-0">{block.height ?? 24}px space</span>
      <div className="flex-1 border-t border-dashed border-zinc-200" />
    </div>
  )
}
