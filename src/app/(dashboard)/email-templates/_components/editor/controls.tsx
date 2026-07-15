'use client'

import { forwardRef, useState } from 'react'
import {
  AlignLeft, AlignCenter, AlignRight, Link as LinkIcon, Unlink, PanelRightClose, PanelRightOpen,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Align, BlockPadding } from '@/lib/email/render-template'

// ─── Layout primitives ─────────────────────────────────────────────────────────

/** Collapse/expand toggle for the inspector panel, shared across its header variants. */
export function PanelToggleButton({
  collapsed, onClick,
}: {
  collapsed: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={collapsed ? 'Expand settings panel' : 'Collapse settings panel'}
      title={collapsed ? 'Expand settings panel' : 'Collapse settings panel'}
      className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
    >
      {collapsed ? <PanelRightOpen className="h-3.5 w-3.5" /> : <PanelRightClose className="h-3.5 w-3.5" />}
    </button>
  )
}

/** A titled group of controls in the inspector. */
export function InspectorGroup({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <div className="space-y-2.5 border-b border-border px-3.5 py-3 last:border-b-0">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{title}</p>
      {children}
    </div>
  )
}

/** A labelled control row. */
export function Field({
  label,
  children,
  stacked,
}: {
  label: string
  children: React.ReactNode
  stacked?: boolean
}) {
  if (stacked) {
    return (
      <div className="space-y-1">
        <span className="text-[11px] font-medium text-muted-foreground">{label}</span>
        {children}
      </div>
    )
  }
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-[11px] font-medium text-muted-foreground">{label}</span>
      <div className="flex items-center gap-1">{children}</div>
    </div>
  )
}

// ─── Color ──────────────────────────────────────────────────────────────────────

export function ColorControl({
  value,
  onChange,
  fallback = '#000000',
}: {
  value?: string
  onChange: (v: string) => void
  fallback?: string
}) {
  const v = value ?? fallback
  return (
    <div className="flex items-center gap-1.5">
      <label className="relative h-6 w-6 shrink-0 cursor-pointer overflow-hidden rounded border border-border">
        <span className="absolute inset-0" style={{ backgroundColor: v }} />
        <input
          type="color"
          value={v}
          onChange={(e) => onChange(e.target.value)}
          className="absolute inset-0 cursor-pointer opacity-0"
        />
      </label>
      <input
        type="text"
        value={v}
        onChange={(e) => onChange(e.target.value)}
        className="h-6 w-[72px] rounded border border-border bg-background px-1.5 font-mono text-[11px] uppercase"
      />
    </div>
  )
}

// ─── Number ─────────────────────────────────────────────────────────────────────

export function NumberControl({
  value,
  onChange,
  min = 0,
  max = 999,
  step = 1,
  unit,
  width = 'w-16',
}: {
  value: number | undefined
  onChange: (v: number) => void
  min?: number
  max?: number
  step?: number
  unit?: string
  width?: string
}) {
  return (
    <div className={cn('flex items-center rounded border border-border bg-background', width)}>
      <input
        type="number"
        value={value ?? ''}
        min={min}
        max={max}
        step={step}
        onChange={(e) => {
          const n = Number(e.target.value)
          if (Number.isFinite(n)) onChange(Math.max(min, Math.min(max, n)))
        }}
        className="h-6 w-full bg-transparent px-1.5 text-[11px] tabular-nums outline-none"
      />
      {unit && <span className="pr-1.5 text-[10px] text-muted-foreground">{unit}</span>}
    </div>
  )
}

// ─── Slider ─────────────────────────────────────────────────────────────────────

export function SliderControl({
  value,
  onChange,
  min = 0,
  max = 100,
  step = 1,
  unit = 'px',
}: {
  value: number
  onChange: (v: number) => void
  min?: number
  max?: number
  step?: number
  unit?: string
}) {
  return (
    <div className="flex items-center gap-2">
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-1 flex-1 cursor-pointer accent-primary"
      />
      <span className="w-10 text-right text-[11px] tabular-nums text-muted-foreground">
        {value}
        {unit}
      </span>
    </div>
  )
}

// ─── Segmented ──────────────────────────────────────────────────────────────────

export function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T
  onChange: (v: T) => void
  options: { value: T; label?: string; icon?: React.ReactNode; title?: string }[]
}) {
  return (
    <div className="inline-flex overflow-hidden rounded border border-border">
      {options.map((opt, i) => (
        <button
          key={opt.value}
          type="button"
          title={opt.title ?? opt.label}
          onClick={() => onChange(opt.value)}
          className={cn(
            'flex h-6 items-center justify-center gap-1 px-2 text-[11px] transition-colors',
            i > 0 && 'border-l border-border',
            value === opt.value
              ? 'bg-primary text-primary-foreground'
              : 'bg-background text-muted-foreground hover:bg-muted',
          )}
        >
          {opt.icon}
          {opt.label}
        </button>
      ))}
    </div>
  )
}

export function AlignControl({
  value,
  onChange,
}: {
  value: Align | undefined
  onChange: (v: Align) => void
}) {
  return (
    <SegmentedControl<Align>
      value={value ?? 'left'}
      onChange={onChange}
      options={[
        { value: 'left', icon: <AlignLeft className="h-3.5 w-3.5" />, title: 'Align left' },
        { value: 'center', icon: <AlignCenter className="h-3.5 w-3.5" />, title: 'Align center' },
        { value: 'right', icon: <AlignRight className="h-3.5 w-3.5" />, title: 'Align right' },
      ]}
    />
  )
}

// ─── Spacing (4-side padding) ────────────────────────────────────────────────────

const SIDES = ['top', 'right', 'bottom', 'left'] as const

/**
 * Four-side spacing editor with a link toggle. When linked, editing one side
 * updates all four. Emits a full BlockPadding so downstream rendering is
 * explicit (partial input fills unspecified sides with 0).
 */
export function SpacingControl({
  value,
  onChange,
  max = 96,
}: {
  value: Partial<BlockPadding> | undefined
  onChange: (v: BlockPadding) => void
  max?: number
}) {
  const resolved: BlockPadding = {
    top: value?.top ?? 0,
    right: value?.right ?? 0,
    bottom: value?.bottom ?? 0,
    left: value?.left ?? 0,
  }
  const allEqual =
    resolved.top === resolved.right &&
    resolved.right === resolved.bottom &&
    resolved.bottom === resolved.left
  const [linked, setLinked] = useState(allEqual)

  function setSide(side: (typeof SIDES)[number], n: number) {
    const clamped = Math.max(0, Math.min(max, n))
    if (linked) {
      onChange({ top: clamped, right: clamped, bottom: clamped, left: clamped })
    } else {
      onChange({ ...resolved, [side]: clamped })
    }
  }

  return (
    <div className="flex items-center gap-2">
      <div className="grid flex-1 grid-cols-4 gap-1">
        {SIDES.map((side) => (
          <div key={side} className="space-y-0.5">
            <input
              type="number"
              min={0}
              max={max}
              value={resolved[side]}
              onChange={(e) => setSide(side, Number(e.target.value))}
              className="h-6 w-full rounded border border-border bg-background px-1 text-center text-[11px] tabular-nums outline-none"
            />
            <span className="block text-center text-[9px] uppercase text-muted-foreground">{side[0]}</span>
          </div>
        ))}
      </div>
      <button
        type="button"
        title={linked ? 'Unlink sides' : 'Link all sides'}
        onClick={() => setLinked((l) => !l)}
        className={cn(
          'flex h-6 w-6 shrink-0 items-center justify-center rounded border',
          linked ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground',
        )}
      >
        {linked ? <LinkIcon className="h-3 w-3" /> : <Unlink className="h-3 w-3" />}
      </button>
    </div>
  )
}

// ─── Select ─────────────────────────────────────────────────────────────────────

export function SelectControl<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T
  onChange: (v: T) => void
  options: { value: T; label: string }[]
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as T)}
      className="h-6 rounded border border-border bg-background px-1.5 text-[11px] outline-none"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  )
}

// ─── Text ────────────────────────────────────────────────────────────────────────

/** `ref` forwards to the underlying <input> — used by the merge-tag picker to
 *  insert `{{ tag }}` at the live cursor position instead of only appending. */
export const TextControl = forwardRef<HTMLInputElement, {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  mono?: boolean
}>(function TextControl({ value, onChange, placeholder, mono }, ref) {
  return (
    <input
      ref={ref}
      type="text"
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      className={cn(
        'h-6 w-full rounded border border-border bg-background px-1.5 text-[11px] outline-none',
        mono && 'font-mono',
      )}
    />
  )
})
