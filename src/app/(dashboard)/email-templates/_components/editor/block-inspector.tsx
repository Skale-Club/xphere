'use client'

import type {
  EmailBlock, TextBlock, HeadingBlock, ImageBlock,
  ButtonBlock, DividerBlock, SpacerBlock, HtmlBlock, Align,
} from '@/lib/email/render-template'
import { BLOCK_TYPE_LABEL } from './registry'
import { ImageUploader } from './image-uploader'
import {
  InspectorGroup, Field, ColorControl, NumberControl, SliderControl,
  AlignControl, SpacingControl, SelectControl, TextControl, SegmentedControl,
} from './controls'

/** Dispatches to the type-specific inspector for the selected block. */
export function BlockInspector({
  block,
  onUpdate,
}: {
  block: EmailBlock
  onUpdate: (updates: Partial<EmailBlock>) => void
}) {
  return (
    <div>
      <div className="border-b border-border px-3.5 py-2.5">
        <p className="text-xs font-semibold">{BLOCK_TYPE_LABEL[block.blockType]} block</p>
      </div>
      {renderInspector(block, onUpdate)}
      {block.blockType !== 'spacer' && (
        <InspectorGroup title="Spacing (padding)">
          <SpacingControl
            value={block.padding}
            onChange={(padding) => onUpdate({ padding })}
          />
        </InspectorGroup>
      )}
    </div>
  )
}

function renderInspector(block: EmailBlock, onUpdate: (u: Partial<EmailBlock>) => void) {
  switch (block.blockType) {
    case 'text':
      return <TextInspector block={block} onUpdate={onUpdate as (u: Partial<TextBlock>) => void} />
    case 'heading':
      return <HeadingInspector block={block} onUpdate={onUpdate as (u: Partial<HeadingBlock>) => void} />
    case 'image':
      return <ImageInspector block={block} onUpdate={onUpdate as (u: Partial<ImageBlock>) => void} />
    case 'button':
      return <ButtonInspector block={block} onUpdate={onUpdate as (u: Partial<ButtonBlock>) => void} />
    case 'divider':
      return <DividerInspector block={block} onUpdate={onUpdate as (u: Partial<DividerBlock>) => void} />
    case 'spacer':
      return <SpacerInspector block={block} onUpdate={onUpdate as (u: Partial<SpacerBlock>) => void} />
    case 'html':
      return <HtmlInspector block={block} onUpdate={onUpdate as (u: Partial<HtmlBlock>) => void} />
    default:
      return null
  }
}

// ─── Text ────────────────────────────────────────────────────────────────────────

function TextInspector({ block, onUpdate }: { block: TextBlock; onUpdate: (u: Partial<TextBlock>) => void }) {
  return (
    <>
      <InspectorGroup title="Typography">
        <p className="text-[10px] text-muted-foreground">Edit the text directly on the canvas.</p>
        <Field label="Size">
          <NumberControl value={block.fontSize ?? 15} min={8} max={64} unit="px" onChange={(v) => onUpdate({ fontSize: v })} />
        </Field>
        <Field label="Line height">
          <NumberControl value={block.lineHeight ?? 1.6} min={1} max={3} step={0.1} onChange={(v) => onUpdate({ lineHeight: v })} />
        </Field>
        <Field label="Color">
          <ColorControl value={block.color} fallback="#333333" onChange={(v) => onUpdate({ color: v })} />
        </Field>
        <Field label="Align">
          <AlignControl value={block.align} onChange={(v) => onUpdate({ align: v })} />
        </Field>
      </InspectorGroup>
    </>
  )
}

// ─── Heading ─────────────────────────────────────────────────────────────────────

function HeadingInspector({ block, onUpdate }: { block: HeadingBlock; onUpdate: (u: Partial<HeadingBlock>) => void }) {
  return (
    <InspectorGroup title="Heading">
      <p className="text-[10px] text-muted-foreground">Edit the heading directly on the canvas.</p>
      <Field label="Level">
        <SegmentedControl<string>
          value={String(block.level ?? 2)}
          onChange={(v) => onUpdate({ level: Number(v) as HeadingBlock['level'] })}
          options={[
            { value: '1', label: 'H1' },
            { value: '2', label: 'H2' },
            { value: '3', label: 'H3' },
          ]}
        />
      </Field>
      <Field label="Size">
        <NumberControl value={block.fontSize} min={12} max={72} unit="px" onChange={(v) => onUpdate({ fontSize: v })} />
      </Field>
      <Field label="Color">
        <ColorControl value={block.color} fallback="#111111" onChange={(v) => onUpdate({ color: v })} />
      </Field>
      <Field label="Align">
        <AlignControl value={block.align} onChange={(v) => onUpdate({ align: v })} />
      </Field>
    </InspectorGroup>
  )
}

// ─── Image ───────────────────────────────────────────────────────────────────────

function ImageInspector({ block, onUpdate }: { block: ImageBlock; onUpdate: (u: Partial<ImageBlock>) => void }) {
  const widthMode: 'full' | 'custom' =
    block.width === undefined || block.width === '100%' || block.width === 'full' ? 'full' : 'custom'
  const customWidth = typeof block.width === 'number' ? block.width : 300

  return (
    <>
      <InspectorGroup title="Image">
        <ImageUploader value={block.src} onChange={(url) => onUpdate({ src: url })} />
        <Field label="Alt text" stacked>
          <TextControl value={block.alt ?? ''} placeholder="Describe the image" onChange={(v) => onUpdate({ alt: v })} />
        </Field>
        <Field label="Link (on click)" stacked>
          <TextControl value={block.link ?? ''} placeholder="https://…" onChange={(v) => onUpdate({ link: v })} />
        </Field>
      </InspectorGroup>
      <InspectorGroup title="Layout">
        <Field label="Width">
          <SegmentedControl<'full' | 'custom'>
            value={widthMode}
            onChange={(m) => onUpdate({ width: m === 'full' ? '100%' : customWidth })}
            options={[
              { value: 'full', label: 'Full' },
              { value: 'custom', label: 'Custom' },
            ]}
          />
        </Field>
        {widthMode === 'custom' && (
          <Field label="Width (px)">
            <NumberControl value={customWidth} min={20} max={1200} unit="px" onChange={(v) => onUpdate({ width: v })} />
          </Field>
        )}
        <Field label="Align">
          <AlignControl value={block.align} onChange={(v) => onUpdate({ align: v })} />
        </Field>
        <Field label="Corner radius">
          <NumberControl value={block.borderRadius ?? 0} min={0} max={64} unit="px" onChange={(v) => onUpdate({ borderRadius: v })} />
        </Field>
      </InspectorGroup>
    </>
  )
}

// ─── Button ──────────────────────────────────────────────────────────────────────

function ButtonInspector({ block, onUpdate }: { block: ButtonBlock; onUpdate: (u: Partial<ButtonBlock>) => void }) {
  return (
    <>
      <InspectorGroup title="Button">
        <Field label="Label" stacked>
          <TextControl value={block.label} onChange={(v) => onUpdate({ label: v })} />
        </Field>
        <Field label="Link (URL)" stacked>
          <TextControl value={block.href} placeholder="https://…" onChange={(v) => onUpdate({ href: v })} />
        </Field>
      </InspectorGroup>
      <InspectorGroup title="Style">
        <Field label="Background">
          <ColorControl value={block.backgroundColor} fallback="#2563eb" onChange={(v) => onUpdate({ backgroundColor: v })} />
        </Field>
        <Field label="Text color">
          <ColorControl value={block.textColor} fallback="#ffffff" onChange={(v) => onUpdate({ textColor: v })} />
        </Field>
        <Field label="Font size">
          <NumberControl value={block.fontSize ?? 15} min={10} max={32} unit="px" onChange={(v) => onUpdate({ fontSize: v })} />
        </Field>
        <Field label="Corner radius">
          <NumberControl value={block.borderRadius ?? 6} min={0} max={40} unit="px" onChange={(v) => onUpdate({ borderRadius: v })} />
        </Field>
      </InspectorGroup>
      <InspectorGroup title="Layout">
        <Field label="Align">
          <AlignControl value={block.align} onChange={(v) => onUpdate({ align: v })} />
        </Field>
        <Field label="Full width">
          <SegmentedControl<'no' | 'yes'>
            value={block.fullWidth ? 'yes' : 'no'}
            onChange={(v) => onUpdate({ fullWidth: v === 'yes' })}
            options={[
              { value: 'no', label: 'No' },
              { value: 'yes', label: 'Yes' },
            ]}
          />
        </Field>
        <Field label="Pad Y">
          <NumberControl value={block.paddingY ?? 12} min={0} max={40} unit="px" onChange={(v) => onUpdate({ paddingY: v })} />
        </Field>
        <Field label="Pad X">
          <NumberControl value={block.paddingX ?? 24} min={0} max={80} unit="px" onChange={(v) => onUpdate({ paddingX: v })} />
        </Field>
      </InspectorGroup>
    </>
  )
}

// ─── Divider ─────────────────────────────────────────────────────────────────────

function DividerInspector({ block, onUpdate }: { block: DividerBlock; onUpdate: (u: Partial<DividerBlock>) => void }) {
  return (
    <InspectorGroup title="Divider">
      <Field label="Color">
        <ColorControl value={block.color} fallback="#e5e5e5" onChange={(v) => onUpdate({ color: v })} />
      </Field>
      <Field label="Thickness">
        <NumberControl value={block.thickness ?? 1} min={1} max={12} unit="px" onChange={(v) => onUpdate({ thickness: v })} />
      </Field>
      <Field label="Style">
        <SelectControl<NonNullable<DividerBlock['style']>>
          value={block.style ?? 'solid'}
          onChange={(v) => onUpdate({ style: v })}
          options={[
            { value: 'solid', label: 'Solid' },
            { value: 'dashed', label: 'Dashed' },
            { value: 'dotted', label: 'Dotted' },
          ]}
        />
      </Field>
      <Field label="Width" stacked>
        <SliderControl value={block.width ?? 100} min={10} max={100} unit="%" onChange={(v) => onUpdate({ width: v })} />
      </Field>
      <Field label="Align">
        <AlignControl value={block.align} onChange={(v) => onUpdate({ align: v as Align })} />
      </Field>
    </InspectorGroup>
  )
}

// ─── Spacer ──────────────────────────────────────────────────────────────────────

function SpacerInspector({ block, onUpdate }: { block: SpacerBlock; onUpdate: (u: Partial<SpacerBlock>) => void }) {
  return (
    <InspectorGroup title="Spacer">
      <Field label="Height" stacked>
        <SliderControl value={block.height ?? 24} min={4} max={160} unit="px" onChange={(v) => onUpdate({ height: v })} />
      </Field>
    </InspectorGroup>
  )
}

// ─── HTML ────────────────────────────────────────────────────────────────────────

function HtmlInspector({ block, onUpdate }: { block: HtmlBlock; onUpdate: (u: Partial<HtmlBlock>) => void }) {
  return (
    <InspectorGroup title="Custom HTML">
      <p className="text-[10px] text-muted-foreground">Email-safe HTML only. Inline styles render most reliably.</p>
      <textarea
        value={block.content}
        onChange={(e) => onUpdate({ content: e.target.value })}
        spellCheck={false}
        className="min-h-40 w-full resize-y rounded border border-border bg-muted/40 p-2 font-mono text-[11px] outline-none"
        placeholder="<p>Custom email-safe HTML…</p>"
      />
    </InspectorGroup>
  )
}
