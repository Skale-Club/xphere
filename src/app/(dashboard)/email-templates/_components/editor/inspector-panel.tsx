'use client'

import { Copy, Trash2, ChevronUp, ChevronDown, ArrowUpLeft, Palette } from 'lucide-react'
import { ScrollArea } from '@/components/ui/scroll-area'
import { findBlockLocation } from '@/lib/email/editor-dnd'
import { useEditor } from './context'
import { BlockInspector } from './block-inspector'
import { SectionInspector } from './section-inspector'
import {
  InspectorGroup, Field, ColorControl, NumberControl, SelectControl,
} from './controls'

const FONT_OPTIONS = [
  { value: 'Arial, Helvetica, sans-serif', label: 'Arial / Helvetica' },
  { value: 'Georgia, serif', label: 'Georgia' },
  { value: "'Times New Roman', Times, serif", label: 'Times New Roman' },
  { value: 'Verdana, Geneva, sans-serif', label: 'Verdana' },
  { value: "'Trebuchet MS', sans-serif", label: 'Trebuchet MS' },
  { value: "'Courier New', Courier, monospace", label: 'Courier New' },
  { value: 'system-ui, -apple-system, sans-serif', label: 'System UI' },
]

export function InspectorPanel() {
  const editor = useEditor()
  const { doc, selectedBlockId, selectedSectionId } = editor

  const selectedBlock = selectedBlockId
    ? doc.sections.flatMap((s) => s.columns.flat()).find((b) => b.id === selectedBlockId) ?? null
    : null
  const selectedSection = selectedSectionId
    ? doc.sections.find((s) => s.id === selectedSectionId) ?? null
    : null

  return (
    <aside className="flex w-72 shrink-0 flex-col overflow-hidden border-l border-border bg-card/40">
      {selectedBlock ? (
        <>
          <BlockActionsHeader />
          <ScrollArea className="flex-1">
            <BlockInspector
              block={selectedBlock}
              onUpdate={(u) => editor.updateBlock(selectedBlock.id, u)}
            />
          </ScrollArea>
        </>
      ) : selectedSection ? (
        <ScrollArea className="flex-1">
          <SectionInspector
            section={selectedSection}
            onUpdate={(u) => editor.updateSection(selectedSection.id, u)}
          />
        </ScrollArea>
      ) : (
        <ScrollArea className="flex-1">
          <DocumentInspector />
        </ScrollArea>
      )}
    </aside>
  )
}

// ─── Block actions (header) ──────────────────────────────────────────────────────

function BlockActionsHeader() {
  const editor = useEditor()
  const id = editor.selectedBlockId!
  const loc = findBlockLocation(editor.doc, id)
  const parentSectionId = loc?.sectionId

  return (
    <div className="flex items-center justify-between gap-1 border-b border-border bg-muted/30 px-2.5 py-2">
      <button
        type="button"
        onClick={() => {
          editor.selectBlock(null)
          if (parentSectionId) editor.selectSection(parentSectionId)
        }}
        className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
        title="Select the parent section"
      >
        <ArrowUpLeft className="h-3.5 w-3.5" />
        Section
      </button>
      <div className="flex items-center gap-0.5">
        <IconBtn title="Move up" onClick={() => editor.moveBlockDir(id, -1)}><ChevronUp className="h-3.5 w-3.5" /></IconBtn>
        <IconBtn title="Move down" onClick={() => editor.moveBlockDir(id, 1)}><ChevronDown className="h-3.5 w-3.5" /></IconBtn>
        <IconBtn title="Duplicate" onClick={() => editor.duplicateBlock(id)}><Copy className="h-3.5 w-3.5" /></IconBtn>
        <IconBtn title="Delete" danger onClick={() => editor.removeBlock(id)}><Trash2 className="h-3.5 w-3.5" /></IconBtn>
      </div>
    </div>
  )
}

function IconBtn({
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
      onClick={onClick}
      className={`flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-muted ${
        danger ? 'hover:text-red-600' : 'hover:text-foreground'
      }`}
    >
      {children}
    </button>
  )
}

// ─── Document inspector ──────────────────────────────────────────────────────────

function DocumentInspector() {
  const { doc, setDoc } = useEditor()
  return (
    <div>
      <div className="flex items-center gap-1.5 border-b border-border px-3.5 py-2.5">
        <Palette className="h-3.5 w-3.5 text-muted-foreground" />
        <p className="text-xs font-semibold">Email settings</p>
      </div>
      <div className="px-3.5 py-2">
        <p className="text-[10px] text-muted-foreground">
          Select a block or section to edit it. These settings apply to the whole email.
        </p>
      </div>
      <InspectorGroup title="Canvas">
        <Field label="Background">
          <ColorControl value={doc.backgroundColor} fallback="#f0f0f0" onChange={(v) => setDoc((p) => ({ ...p, backgroundColor: v }))} />
        </Field>
        <Field label="Content width">
          <NumberControl value={doc.contentWidth ?? 600} min={320} max={900} unit="px" onChange={(v) => setDoc((p) => ({ ...p, contentWidth: v }))} />
        </Field>
        <p className="text-[10px] text-muted-foreground">Most clients render best between 560–680 px.</p>
      </InspectorGroup>
      <InspectorGroup title="Typography">
        <Field label="Font" stacked>
          <SelectControl<string>
            value={doc.fontFamily ?? 'Arial, Helvetica, sans-serif'}
            onChange={(v) => setDoc((p) => ({ ...p, fontFamily: v }))}
            options={FONT_OPTIONS}
          />
        </Field>
        <p className="text-[10px] text-muted-foreground">Email-safe fonts only — web fonts won&apos;t render in most clients.</p>
      </InspectorGroup>
    </div>
  )
}
