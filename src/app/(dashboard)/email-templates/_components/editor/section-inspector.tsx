'use client'

import type { EmailSection } from '@/lib/email/render-template'
import { reflowSectionColumns } from '@/lib/email/editor-dnd'
import { ImageUploader } from './image-uploader'
import {
  InspectorGroup, Field, ColorControl, NumberControl,
  SpacingControl, SegmentedControl, SliderControl,
} from './controls'

/**
 * Inspector for the selected section. Layout changes reflow the columns array
 * losslessly: growing adds empty columns; shrinking merges the dropped columns'
 * blocks into the last kept column.
 */
export function SectionInspector({
  section,
  onUpdate,
}: {
  section: EmailSection
  onUpdate: (updates: Partial<EmailSection>) => void
}) {
  const layout = section.layout ?? 1

  function changeLayout(next: 1 | 2 | 3) {
    onUpdate({ layout: next, columns: reflowSectionColumns(section.columns, next) })
  }

  return (
    <div>
      <div className="border-b border-border px-3.5 py-2.5">
        <p className="text-xs font-semibold">Section</p>
      </div>

      <InspectorGroup title="Layout">
        <Field label="Columns">
          <SegmentedControl<string>
            value={String(layout)}
            onChange={(v) => changeLayout(Number(v) as 1 | 2 | 3)}
            options={[
              { value: '1', label: '1' },
              { value: '2', label: '2' },
              { value: '3', label: '3' },
            ]}
          />
        </Field>
        {layout > 1 && (
          <Field label="Column gap" stacked>
            <SliderControl value={section.columnsGap ?? 0} min={0} max={64} unit="px" onChange={(v) => onUpdate({ columnsGap: v })} />
          </Field>
        )}
        <Field label="Vertical align">
          <SegmentedControl<'top' | 'middle' | 'bottom'>
            value={section.verticalAlign ?? 'top'}
            onChange={(v) => onUpdate({ verticalAlign: v })}
            options={[
              { value: 'top', label: 'Top' },
              { value: 'middle', label: 'Mid' },
              { value: 'bottom', label: 'Bot' },
            ]}
          />
        </Field>
      </InspectorGroup>

      <InspectorGroup title="Background">
        <Field label="Color">
          <ColorControl value={section.backgroundColor} fallback="#ffffff" onChange={(v) => onUpdate({ backgroundColor: v })} />
        </Field>
        <ImageUploader
          label="Background image"
          value={section.backgroundImage ?? ''}
          onChange={(url) => onUpdate({ backgroundImage: url })}
        />
      </InspectorGroup>

      <InspectorGroup title="Appearance">
        <Field label="Corner radius">
          <NumberControl value={section.borderRadius ?? 0} min={0} max={48} unit="px" onChange={(v) => onUpdate({ borderRadius: v })} />
        </Field>
      </InspectorGroup>

      <InspectorGroup title="Padding">
        <SpacingControl value={section.padding} onChange={(padding) => onUpdate({ padding })} />
      </InspectorGroup>
    </div>
  )
}
