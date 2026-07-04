'use client'

import { Fragment } from 'react'
import {
  Plus, GripVertical, Trash2, Copy, Bookmark, Palette, Columns2, ImageOff,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Button } from '@/components/ui/button'
import {
  SortableContext, verticalListSortingStrategy, useSortable,
} from '@dnd-kit/sortable'
import { useDroppable } from '@dnd-kit/core'
import type { DraggableAttributes, DraggableSyntheticListeners } from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import type {
  EmailSection, EmailBlock, TextBlock, HeadingBlock, ImageBlock,
  ButtonBlock, DividerBlock, SpacerBlock, HtmlBlock,
} from '@/lib/email/render-template'
import { resolveBlockPadding } from '@/lib/email/render-template'
import { useEditor } from './context'

type DragHandleProps = { attributes: DraggableAttributes; listeners: DraggableSyntheticListeners }

// ─── Canvas ───────────────────────────────────────────────────────────────────

export function Canvas() {
  const editor = useEditor()
  const { doc } = editor

  return (
    <ScrollArea className="flex-1 bg-muted/40">
      <div
        className="flex min-h-full flex-col items-center px-6 py-8"
        onClick={() => {
          editor.selectBlock(null)
          editor.selectSection(null)
        }}
      >
        <div
          className="w-full overflow-hidden rounded-lg shadow-sm ring-1 ring-black/5"
          style={{ maxWidth: `${doc.contentWidth ?? 600}px`, backgroundColor: '#ffffff' }}
          onClick={(e) => e.stopPropagation()}
        >
          {doc.sections.length === 0 && <EmptyCanvas />}

          <SortableContext items={doc.sections.map((s) => s.id)} strategy={verticalListSortingStrategy}>
            {doc.sections.map((section) => (
              <SortableSection key={section.id} section={section} />
            ))}
          </SortableContext>
        </div>

        {/* Editor chrome — deliberately OUTSIDE the white email frame and centered
            so it never reads as part of the email/preview content. Section
            templates are a single section, so no add-section affordance. */}
        {editor.variant !== 'section' && <AddSectionBar />}
      </div>
    </ScrollArea>
  )
}

function EmptyCanvas() {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Columns2 className="h-6 w-6" />
      </div>
      <div>
        <p className="text-sm font-medium text-zinc-700">Start your email</p>
        <p className="text-xs text-zinc-500">Use &ldquo;Add section&rdquo; below, then drag blocks in from the left.</p>
      </div>
    </div>
  )
}

function AddSectionBar() {
  const editor = useEditor()
  return (
    <div
      className="mt-5 flex items-center gap-1.5 rounded-full border border-border bg-card/70 px-2 py-1.5 shadow-sm backdrop-blur-sm"
      onClick={(e) => e.stopPropagation()}
    >
      <span className="px-1.5 text-xs font-medium text-muted-foreground">Add section</span>
      {([1, 2, 3] as const).map((layout) => (
        <Button
          key={layout}
          size="sm"
          variant="ghost"
          className="h-7 gap-1 rounded-full px-2.5 text-xs"
          onClick={() => editor.addSection(layout)}
        >
          <Plus className="h-3 w-3" />
          {layout}-col
        </Button>
      ))}
    </div>
  )
}

// ─── Section ──────────────────────────────────────────────────────────────────

function SortableSection({ section }: { section: EmailSection }) {
  const editor = useEditor()
  const isSelected = editor.selectedSectionId === section.id && !editor.selectedBlockId
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: section.id })
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    backgroundColor: section.backgroundColor ?? '#ffffff',
    ...(section.backgroundImage
      ? { backgroundImage: `url('${section.backgroundImage}')`, backgroundSize: 'cover', backgroundPosition: 'center' }
      : {}),
    ...(section.borderRadius ? { borderRadius: `${section.borderRadius}px` } : {}),
  }

  const padding = resolveSectionPadding(section)
  const gap = section.columnsGap ?? 0
  const valign = section.verticalAlign ?? 'top'

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'group/section relative border-2 transition-colors',
        isSelected ? 'border-primary' : 'border-transparent hover:border-primary/30',
      )}
      onClick={(e) => {
        e.stopPropagation()
        editor.selectBlock(null)
        editor.selectSection(section.id)
      }}
    >
      {/* Floating section toolbar — hidden for section templates (single section:
          no reorder / duplicate / delete / save-as-section-template; styling is edited by
          selecting the section → inspector). */}
      {editor.variant !== 'section' && (
        <div className="absolute right-1 top-1 z-30 flex items-center gap-0.5 rounded border border-zinc-200 bg-white/95 opacity-0 shadow-sm transition-opacity group-hover/section:opacity-100">
          <button
            {...attributes}
            {...listeners}
            className="flex h-6 w-6 cursor-grab items-center justify-center rounded text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800 active:cursor-grabbing"
            title="Drag to reorder section"
            onClick={(e) => e.stopPropagation()}
          >
            <GripVertical className="h-3 w-3" />
          </button>
          <SectionIconBtn title="Section settings" onClick={() => editor.selectSection(section.id)}>
            <Palette className="h-3 w-3" />
          </SectionIconBtn>
          <SectionIconBtn title="Save as section template" onClick={() => editor.openSaveSectionTemplate(section.id)}>
            <Bookmark className="h-3 w-3" />
          </SectionIconBtn>
          <SectionIconBtn title="Duplicate section" onClick={() => editor.duplicateSection(section.id)}>
            <Copy className="h-3 w-3" />
          </SectionIconBtn>
          <SectionIconBtn title="Delete section" danger onClick={() => editor.removeSection(section.id)}>
            <Trash2 className="h-3 w-3" />
          </SectionIconBtn>
        </div>
      )}

      {/* Columns */}
      <div className="flex" style={{ alignItems: valignToItems(valign) }}>
        {Array.from({ length: section.layout }).map((_, colIdx) => (
          <Fragment key={colIdx}>
            <ColumnEditor section={section} colIdx={colIdx} padding={padding} />
            {section.layout > 1 && colIdx < section.layout - 1 && gap > 0 && (
              <div style={{ width: gap }} className="shrink-0" />
            )}
          </Fragment>
        ))}
      </div>
    </div>
  )
}

function SectionIconBtn({
  title, onClick, danger, children,
}: {
  title: string
  onClick: () => void
  danger?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={(e) => { e.stopPropagation(); onClick() }}
      className={cn(
        'flex h-6 w-6 items-center justify-center rounded text-zinc-500 hover:bg-zinc-100',
        danger ? 'hover:text-red-600' : 'hover:text-zinc-800',
      )}
    >
      {children}
    </button>
  )
}

// ─── Column ───────────────────────────────────────────────────────────────────

function ColumnEditor({
  section, colIdx, padding,
}: {
  section: EmailSection
  colIdx: number
  padding: { top: number; right: number; bottom: number; left: number }
}) {
  const blocks = section.columns[colIdx] ?? []

  return (
    <div
      className="group/col min-w-0 flex-1"
      style={{ paddingTop: padding.top, paddingRight: padding.right, paddingBottom: padding.bottom, paddingLeft: padding.left }}
    >
      {blocks.length === 0 && <EmptyColumnDropZone sectionId={section.id} colIdx={colIdx} />}

      <SortableContext
        id={`col:${section.id}:${colIdx}`}
        items={blocks.map((b) => b.id)}
        strategy={verticalListSortingStrategy}
      >
        {blocks.map((block) => (
          <SortableBlock key={block.id} block={block} sectionId={section.id} colIdx={colIdx}>
            {(handle) => <CanvasBlock block={block} dragHandle={handle} />}
          </SortableBlock>
        ))}
      </SortableContext>

      {/* Blocks are added by dragging from the left palette — the tail zone below
          lets you drop at the end of a non-empty column. */}
      {blocks.length > 0 && <ColumnTailDropZone sectionId={section.id} colIdx={colIdx} />}
    </div>
  )
}

function EmptyColumnDropZone({ sectionId, colIdx }: { sectionId: string; colIdx: number }) {
  const { setNodeRef, isOver } = useDroppable({
    id: `col:${sectionId}:${colIdx}`,
    data: { type: 'column', sectionId, colIdx },
  })
  return (
    <div
      ref={setNodeRef}
      className={cn(
        'mb-1.5 flex min-h-16 items-center justify-center rounded border-2 border-dashed text-xs transition-colors',
        isOver ? 'border-primary bg-primary/5 text-primary' : 'border-zinc-300 bg-zinc-50/80 text-zinc-400',
      )}
    >
      Drop a block here
    </div>
  )
}

/**
 * Append target at the end of a NON-empty column. A resting invisible strip that
 * expands + highlights while a drag hovers it, so blocks can be dropped after the
 * last one (dropping onto a block inserts before it). Shares the column's
 * `col:*` droppable id — resolveDropTarget maps it to append (index = length).
 */
function ColumnTailDropZone({ sectionId, colIdx }: { sectionId: string; colIdx: number }) {
  const { setNodeRef, isOver } = useDroppable({
    id: `col:${sectionId}:${colIdx}`,
    data: { type: 'column', sectionId, colIdx },
  })
  return (
    <div
      ref={setNodeRef}
      className={cn(
        'rounded border-2 border-dashed transition-all',
        isOver ? 'mt-1.5 h-12 border-primary bg-primary/5' : 'mt-0 h-2 border-transparent',
      )}
    />
  )
}

// ─── Sortable block wrapper ─────────────────────────────────────────────────────

function SortableBlock({
  block, sectionId, colIdx, children,
}: {
  block: EmailBlock
  sectionId: string
  colIdx: number
  children: (handle: DragHandleProps) => React.ReactNode
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: block.id,
    data: { type: 'block', blockId: block.id, sectionId, colIdx },
  })
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 }}>
      {children({ attributes, listeners })}
    </div>
  )
}

// ─── Canvas block (WYSIWYG preview + inline edit + toolbar) ──────────────────────

function CanvasBlock({ block, dragHandle }: { block: EmailBlock; dragHandle: DragHandleProps }) {
  const editor = useEditor()
  const isSelected = editor.selectedBlockId === block.id
  const pad = resolveBlockPadding(block)

  return (
    <div
      className={cn(
        'group/block relative cursor-pointer rounded-sm border-2 transition-colors',
        isSelected ? 'border-primary' : 'border-transparent hover:border-primary/40',
      )}
      onClick={(e) => {
        e.stopPropagation()
        editor.selectBlock(block.id)
      }}
    >
      {/* Floating block toolbar */}
      <div className="absolute right-0.5 top-0.5 z-20 flex items-center gap-0.5 opacity-0 transition-opacity group-hover/block:opacity-100">
        <button
          {...dragHandle.attributes}
          {...dragHandle.listeners}
          className="flex h-5 w-5 cursor-grab items-center justify-center rounded border border-zinc-300 bg-white text-zinc-500 shadow-sm hover:text-zinc-800 active:cursor-grabbing"
          title="Drag to move block"
          onClick={(e) => e.stopPropagation()}
        >
          <GripVertical className="h-2.5 w-2.5" />
        </button>
        <button
          className="flex h-5 w-5 items-center justify-center rounded border border-zinc-300 bg-white text-zinc-500 shadow-sm hover:text-zinc-800"
          title="Duplicate block"
          onClick={(e) => { e.stopPropagation(); editor.duplicateBlock(block.id) }}
        >
          <Copy className="h-2.5 w-2.5" />
        </button>
        <button
          className="flex h-5 w-5 items-center justify-center rounded border border-zinc-300 bg-white text-zinc-500 shadow-sm hover:border-red-400 hover:bg-red-500 hover:text-white"
          title="Delete block"
          onClick={(e) => { e.stopPropagation(); editor.removeBlock(block.id) }}
        >
          <Trash2 className="h-2.5 w-2.5" />
        </button>
      </div>

      <div style={{ padding: `${pad.top}px ${pad.right}px ${pad.bottom}px ${pad.left}px` }}>
        <BlockPreview block={block} onUpdate={(u) => editor.updateBlock(block.id, u)} />
      </div>
    </div>
  )
}

// ─── Per-type preview ────────────────────────────────────────────────────────────

function BlockPreview({ block, onUpdate }: { block: EmailBlock; onUpdate: (u: Partial<EmailBlock>) => void }) {
  switch (block.blockType) {
    case 'text':
      return <TextPreview block={block} onUpdate={onUpdate as (u: Partial<TextBlock>) => void} />
    case 'heading':
      return <HeadingPreview block={block} onUpdate={onUpdate as (u: Partial<HeadingBlock>) => void} />
    case 'image':
      return <ImagePreview block={block} />
    case 'button':
      return <ButtonPreview block={block} />
    case 'divider':
      return <DividerPreview block={block} />
    case 'spacer':
      return <SpacerPreview block={block} />
    case 'html':
      return <HtmlPreview block={block} />
    default:
      return null
  }
}

function TextPreview({ block, onUpdate }: { block: TextBlock; onUpdate: (u: Partial<TextBlock>) => void }) {
  return (
    <div
      contentEditable
      suppressContentEditableWarning
      className="outline-none"
      style={{
        color: block.color ?? '#333',
        textAlign: block.align ?? 'left',
        fontSize: `${block.fontSize ?? 15}px`,
        lineHeight: block.lineHeight ?? 1.6,
        minHeight: '1.4em',
      }}
      onBlur={(e) => onUpdate({ content: e.currentTarget.innerHTML })}
      dangerouslySetInnerHTML={{ __html: block.content }}
    />
  )
}

function HeadingPreview({ block, onUpdate }: { block: HeadingBlock; onUpdate: (u: Partial<HeadingBlock>) => void }) {
  const sizes: Record<number, number> = { 1: 32, 2: 24, 3: 20 }
  const level = block.level ?? 2
  return (
    <div
      contentEditable
      suppressContentEditableWarning
      className="font-bold outline-none"
      style={{
        color: block.color ?? '#111',
        textAlign: block.align ?? 'left',
        fontSize: `${block.fontSize ?? sizes[level] ?? 24}px`,
        lineHeight: 1.3,
        minHeight: '1.3em',
      }}
      onBlur={(e) => onUpdate({ content: e.currentTarget.innerHTML })}
      dangerouslySetInnerHTML={{ __html: block.content }}
    />
  )
}

function ImagePreview({ block }: { block: ImageBlock }) {
  const align = block.align ?? 'center'
  const hasImage = Boolean(block.src) && !block.src.includes('placehold.co')
  if (!block.src || !hasImage) {
    return (
      <div
        className="flex flex-col items-center justify-center gap-1 rounded border-2 border-dashed border-zinc-300 bg-zinc-50 py-8 text-zinc-400"
        style={{ textAlign: align }}
      >
        <ImageOff className="h-6 w-6" />
        <span className="text-[11px]">Click, then upload an image →</span>
      </div>
    )
  }
  const width = typeof block.width === 'number' ? `${block.width}px` : (block.width ?? '100%')
  const marginX = align === 'center' ? '0 auto' : align === 'right' ? '0 0 0 auto' : '0'
  return (
    <div style={{ textAlign: align }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={block.src}
        alt={block.alt ?? ''}
        style={{
          width,
          maxWidth: '100%',
          height: 'auto',
          display: 'block',
          margin: marginX,
          borderRadius: block.borderRadius ? `${block.borderRadius}px` : undefined,
        }}
      />
    </div>
  )
}

function ButtonPreview({ block }: { block: ButtonBlock }) {
  const align = block.align ?? 'center'
  return (
    <div style={{ textAlign: align }}>
      <span
        style={{
          display: block.fullWidth ? 'block' : 'inline-block',
          textAlign: 'center',
          backgroundColor: block.backgroundColor ?? '#2563eb',
          color: block.textColor ?? '#fff',
          borderRadius: `${block.borderRadius ?? 6}px`,
          padding: `${block.paddingY ?? 12}px ${block.paddingX ?? 24}px`,
          fontSize: `${block.fontSize ?? 15}px`,
          fontWeight: 600,
        }}
      >
        {block.label || 'Button'}
      </span>
    </div>
  )
}

function DividerPreview({ block }: { block: DividerBlock }) {
  const align = block.align ?? 'center'
  const marginX = align === 'center' ? '0 auto' : align === 'right' ? '0 0 0 auto' : '0'
  return (
    <hr
      style={{
        border: 0,
        borderTop: `${block.thickness ?? 1}px ${block.style ?? 'solid'} ${block.color ?? '#e5e5e5'}`,
        width: `${Math.max(1, Math.min(100, block.width ?? 100))}%`,
        margin: marginX,
      }}
    />
  )
}

function SpacerPreview({ block }: { block: SpacerBlock }) {
  const h = block.height ?? 24
  return (
    <div
      className="flex items-center justify-center rounded bg-[repeating-linear-gradient(45deg,#f4f4f5,#f4f4f5_6px,#fafafa_6px,#fafafa_12px)] text-[10px] text-zinc-400"
      style={{ height: h }}
    >
      {h}px
    </div>
  )
}

function HtmlPreview({ block }: { block: HtmlBlock }) {
  if (!block.content?.trim()) {
    return <div className="rounded border border-dashed border-zinc-300 bg-zinc-50 px-3 py-4 text-center text-[11px] italic text-zinc-400">Empty HTML block — edit in the panel →</div>
  }
  return <div className="text-sm [&_*]:max-w-full" dangerouslySetInnerHTML={{ __html: block.content }} />
}

// ─── helpers ─────────────────────────────────────────────────────────────────────

function resolveSectionPadding(section: EmailSection) {
  return {
    top: section.padding?.top ?? 16,
    right: section.padding?.right ?? 24,
    bottom: section.padding?.bottom ?? 16,
    left: section.padding?.left ?? 24,
  }
}

function valignToItems(v: 'top' | 'middle' | 'bottom'): string {
  return v === 'middle' ? 'center' : v === 'bottom' ? 'flex-end' : 'flex-start'
}
