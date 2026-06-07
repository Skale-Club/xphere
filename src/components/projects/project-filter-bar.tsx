'use client'

import * as React from 'react'
import { Search, X, Star, StarOff, ChevronDown, Check, Filter, BookmarkPlus } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import type { ProjectSavedViewRow } from '@/types/database'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ProjectFilterState {
  step?: ('backlog' | 'todo' | 'doing' | 'done')[]
  priority?: ('low' | 'medium' | 'high' | 'urgent')[]
  assignee_id?: string[]
  label_ids?: string[]
  due_before?: string
  due_after?: string
  overdue?: boolean
  search?: string
}

interface ProjectFilterBarProps {
  filters: ProjectFilterState
  onFiltersChange: (filters: ProjectFilterState) => void
  savedViews: ProjectSavedViewRow[]
  activeViewId: string | null
  onViewSelect: (view: ProjectSavedViewRow) => void
  onViewSave: (name: string, setAsDefault: boolean) => Promise<void>
  onViewDelete: (id: string) => Promise<void>
  assignees: { id: string; full_name: string | null; avatar_url: string | null; email: string }[]
  labels: { id: string; name: string; color: string }[]
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STEP_OPTIONS: { value: 'backlog' | 'todo' | 'doing' | 'done'; label: string; color: string }[] = [
  { value: 'backlog', label: 'Backlog', color: 'text-text-tertiary' },
  { value: 'todo', label: 'To Do', color: 'text-blue-400' },
  { value: 'doing', label: 'Doing', color: 'text-yellow-400' },
  { value: 'done', label: 'Done', color: 'text-green-400' },
]

const PRIORITY_OPTIONS: { value: 'low' | 'medium' | 'high' | 'urgent'; label: string; color: string }[] = [
  { value: 'low', label: 'Low', color: 'text-blue-400' },
  { value: 'medium', label: 'Medium', color: 'text-yellow-400' },
  { value: 'high', label: 'High', color: 'text-orange-400' },
  { value: 'urgent', label: 'Urgent', color: 'text-red-400' },
]

const DUE_DATE_PRESETS = [
  { value: 'overdue', label: 'Overdue' },
  { value: 'today', label: 'Today' },
  { value: 'this_week', label: 'This week' },
  { value: 'this_month', label: 'This month' },
  { value: 'custom', label: 'Custom range' },
]

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isFiltersEmpty(f: ProjectFilterState): boolean {
  return (
    (!f.step || f.step.length === 0) &&
    (!f.priority || f.priority.length === 0) &&
    (!f.assignee_id || f.assignee_id.length === 0) &&
    (!f.label_ids || f.label_ids.length === 0) &&
    !f.due_before &&
    !f.due_after &&
    !f.overdue &&
    (!f.search || f.search.trim() === '')
  )
}

function filtersEqual(a: ProjectFilterState, b: ProjectFilterState): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

function getDueDatePreset(filters: ProjectFilterState): string | null {
  if (filters.overdue) return 'overdue'
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())

  if (filters.due_before && !filters.due_after) {
    const before = new Date(filters.due_before)
    const todayEnd = new Date(today)
    todayEnd.setDate(todayEnd.getDate() + 1)
    if (before.getTime() === todayEnd.getTime()) return 'today'

    const weekEnd = new Date(today)
    weekEnd.setDate(weekEnd.getDate() + 7)
    if (before.getTime() === weekEnd.getTime()) return 'this_week'

    const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 1)
    if (before.getTime() === monthEnd.getTime()) return 'this_month'

    return 'custom'
  }
  if (filters.due_before || filters.due_after) return 'custom'
  return null
}

function applyDueDatePreset(preset: string): Partial<ProjectFilterState> {
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())

  switch (preset) {
    case 'overdue':
      return { overdue: true, due_before: undefined, due_after: undefined }
    case 'today': {
      const end = new Date(today)
      end.setDate(end.getDate() + 1)
      return { overdue: false, due_after: today.toISOString(), due_before: end.toISOString() }
    }
    case 'this_week': {
      const end = new Date(today)
      end.setDate(end.getDate() + 7)
      return { overdue: false, due_after: today.toISOString(), due_before: end.toISOString() }
    }
    case 'this_month': {
      const end = new Date(today.getFullYear(), today.getMonth() + 1, 1)
      return { overdue: false, due_after: today.toISOString(), due_before: end.toISOString() }
    }
    default:
      return {}
  }
}

function getInitials(name: string | null, email: string): string {
  if (name) {
    const parts = name.trim().split(' ')
    return (parts[0][0] + (parts[1]?.[0] ?? '')).toUpperCase()
  }
  return email[0].toUpperCase()
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

interface MultiSelectChipProps {
  label: string
  count?: number
  active?: boolean
  children: React.ReactNode
}

function MultiSelectChip({ label, count, active, children }: MultiSelectChipProps) {
  const [open, setOpen] = React.useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className={cn(
            'inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md border text-xs font-medium transition-colors whitespace-nowrap',
            active
              ? 'border-accent/60 bg-accent/10 text-accent'
              : 'border-border bg-bg-secondary text-text-secondary hover:border-border-strong hover:text-text-primary'
          )}
        >
          <span>{label}</span>
          {active && count !== undefined && count > 0 && (
            <Badge
              className={cn(
                'h-4 min-w-4 px-1 text-[10px] leading-none rounded-full',
                'bg-accent/20 text-accent border-0'
              )}
            >
              {count}
            </Badge>
          )}
          <ChevronDown className="h-3 w-3 opacity-60 flex-shrink-0" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-52 p-1.5 bg-bg-elevated border border-border shadow-elevation-md"
        align="start"
        sideOffset={6}
      >
        {children}
      </PopoverContent>
    </Popover>
  )
}

interface CheckItemProps {
  checked: boolean
  onToggle: () => void
  children: React.ReactNode
  colorClass?: string
}

function CheckItem({ checked, onToggle, children, colorClass }: CheckItemProps) {
  return (
    <button
      onClick={onToggle}
      className={cn(
        'w-full flex items-center gap-2 px-2 py-1.5 rounded-sm text-xs',
        'hover:bg-bg-tertiary transition-colors text-left',
        checked ? 'text-text-primary' : 'text-text-secondary'
      )}
    >
      <div
        className={cn(
          'h-3.5 w-3.5 rounded-sm border flex items-center justify-center flex-shrink-0',
          checked ? 'border-accent bg-accent' : 'border-border'
        )}
      >
        {checked && <Check className="h-2.5 w-2.5 text-white" />}
      </div>
      <span className={cn('flex-1', colorClass)}>{children}</span>
    </button>
  )
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function ProjectFilterBar({
  filters,
  onFiltersChange,
  savedViews,
  activeViewId,
  onViewSelect,
  onViewSave,
  onViewDelete,
  assignees,
  labels,
}: ProjectFilterBarProps) {
  const [savingView, setSavingView] = React.useState(false)
  const [saveInputVisible, setSaveInputVisible] = React.useState(false)
  const [saveViewName, setSaveViewName] = React.useState('')
  const [saveAsDefault, setSaveAsDefault] = React.useState(false)
  const [isSaving, setIsSaving] = React.useState(false)
  const [customDueBefore, setCustomDueBefore] = React.useState(filters.due_before ?? '')
  const [customDueAfter, setCustomDueAfter] = React.useState(filters.due_after ?? '')
  const [dueDateOpen, setDueDateOpen] = React.useState(false)
  const [dueDateMode, setDueDateMode] = React.useState<string | null>(getDueDatePreset(filters))
  const saveInputRef = React.useRef<HTMLInputElement>(null)

  React.useEffect(() => {
    if (saveInputVisible) {
      saveInputRef.current?.focus()
    }
  }, [saveInputVisible])

  // Detect whether filters differ from active view
  const activeView = savedViews.find((v) => v.id === activeViewId) ?? null
  const activeViewFilters = activeView?.filters as ProjectFilterState | undefined
  const filtersEmpty = isFiltersEmpty(filters)
  const filtersDifferFromView =
    activeView && activeViewFilters
      ? !filtersEqual(filters, activeViewFilters)
      : !filtersEmpty

  const showSaveButton = filtersDifferFromView && !saveInputVisible

  // ---------------------------------------------------------------------------
  // Toggle helpers
  // ---------------------------------------------------------------------------

  function toggleArrayValue<T extends string>(
    key: keyof ProjectFilterState,
    value: T,
    current: T[] | undefined
  ) {
    const next = current ? [...current] : []
    const idx = next.indexOf(value)
    if (idx >= 0) {
      next.splice(idx, 1)
    } else {
      next.push(value)
    }
    onFiltersChange({ ...filters, [key]: next.length > 0 ? next : undefined })
  }

  function clearAll() {
    onFiltersChange({})
    setDueDateMode(null)
    setCustomDueBefore('')
    setCustomDueAfter('')
  }

  function handleDueDatePreset(preset: string) {
    if (preset === 'custom') {
      setDueDateMode('custom')
      return
    }
    const patch = applyDueDatePreset(preset)
    setDueDateMode(preset)
    onFiltersChange({ ...filters, ...patch })
    setDueDateOpen(false)
  }

  function applyCustomRange() {
    onFiltersChange({
      ...filters,
      overdue: false,
      due_after: customDueAfter || undefined,
      due_before: customDueBefore || undefined,
    })
    setDueDateOpen(false)
  }

  function clearDueDate() {
    setDueDateMode(null)
    setCustomDueBefore('')
    setCustomDueAfter('')
    onFiltersChange({
      ...filters,
      overdue: undefined,
      due_before: undefined,
      due_after: undefined,
    })
  }

  async function handleSaveView() {
    if (!saveViewName.trim()) return
    setIsSaving(true)
    try {
      await onViewSave(saveViewName.trim(), saveAsDefault)
      setSaveViewName('')
      setSaveAsDefault(false)
      setSaveInputVisible(false)
    } finally {
      setIsSaving(false)
    }
  }

  // ---------------------------------------------------------------------------
  // Active filter pills data
  // ---------------------------------------------------------------------------

  const activeFilterPills: { key: string; label: string; onRemove: () => void }[] = []

  if (filters.step && filters.step.length > 0) {
    for (const s of filters.step) {
      const opt = STEP_OPTIONS.find((o) => o.value === s)
      activeFilterPills.push({
        key: `step-${s}`,
        label: `Status: ${opt?.label ?? s}`,
        onRemove: () =>
          onFiltersChange({
            ...filters,
            step: filters.step!.filter((x) => x !== s) || undefined,
          }),
      })
    }
  }

  if (filters.priority && filters.priority.length > 0) {
    for (const p of filters.priority) {
      const opt = PRIORITY_OPTIONS.find((o) => o.value === p)
      activeFilterPills.push({
        key: `priority-${p}`,
        label: `Priority: ${opt?.label ?? p}`,
        onRemove: () =>
          onFiltersChange({
            ...filters,
            priority: filters.priority!.filter((x) => x !== p) || undefined,
          }),
      })
    }
  }

  if (filters.assignee_id && filters.assignee_id.length > 0) {
    for (const id of filters.assignee_id) {
      const a = assignees.find((x) => x.id === id)
      const name = a?.full_name ?? a?.email ?? id
      activeFilterPills.push({
        key: `assignee-${id}`,
        label: `Assignee: ${name}`,
        onRemove: () =>
          onFiltersChange({
            ...filters,
            assignee_id: filters.assignee_id!.filter((x) => x !== id) || undefined,
          }),
      })
    }
  }

  if (filters.label_ids && filters.label_ids.length > 0) {
    for (const id of filters.label_ids) {
      const l = labels.find((x) => x.id === id)
      activeFilterPills.push({
        key: `label-${id}`,
        label: `Label: ${l?.name ?? id}`,
        onRemove: () =>
          onFiltersChange({
            ...filters,
            label_ids: filters.label_ids!.filter((x) => x !== id) || undefined,
          }),
      })
    }
  }

  if (filters.overdue) {
    activeFilterPills.push({
      key: 'overdue',
      label: 'Overdue',
      onRemove: clearDueDate,
    })
  } else if (filters.due_before || filters.due_after) {
    const presetLabel = DUE_DATE_PRESETS.find((p) => p.value === dueDateMode)?.label ?? 'Custom range'
    activeFilterPills.push({
      key: 'due',
      label: `Due: ${presetLabel}`,
      onRemove: clearDueDate,
    })
  }

  const dueDateActive = !!(filters.overdue || filters.due_before || filters.due_after)

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="flex flex-col gap-2 py-2">
      {/* Row 1 — Saved views */}
      <div className="flex items-center gap-2">
        <div className="flex-1 flex items-center gap-1.5 overflow-x-auto scrollbar-none min-w-0">
          {savedViews.length === 0 && (
            <span className="text-xs text-text-tertiary">No saved views</span>
          )}
          {savedViews.map((view) => {
            const isActive = view.id === activeViewId
            return (
              <div
                key={view.id}
                className={cn(
                  'group inline-flex items-center gap-1 h-6 pl-2.5 pr-1 rounded-full border text-xs whitespace-nowrap transition-colors flex-shrink-0',
                  isActive
                    ? 'border-accent bg-accent/15 text-accent'
                    : 'border-border bg-bg-secondary text-text-secondary hover:border-border-strong hover:text-text-primary'
                )}
              >
                <button
                  onClick={() => onViewSelect(view)}
                  className="inline-flex items-center gap-1"
                >
                  {view.is_default && (
                    <Star className="h-3 w-3 fill-current opacity-70 flex-shrink-0" />
                  )}
                  <span>{view.name}</span>
                </button>
                <button
                  onClick={() => onViewDelete(view.id)}
                  className={cn(
                    'ml-0.5 rounded-full p-0.5 transition-colors flex-shrink-0',
                    'opacity-0 group-hover:opacity-100',
                    isActive
                      ? 'hover:bg-accent/20 text-accent'
                      : 'hover:bg-bg-tertiary text-text-tertiary'
                  )}
                  title="Delete view"
                >
                  <X className="h-2.5 w-2.5" />
                </button>
              </div>
            )
          })}
        </div>

        {/* Save view button / inline form */}
        {showSaveButton && !saveInputVisible && (
          <button
            onClick={() => setSaveInputVisible(true)}
            className="inline-flex items-center gap-1.5 h-6 px-2.5 rounded-full border border-dashed border-border text-xs text-text-secondary hover:border-accent hover:text-accent transition-colors flex-shrink-0"
          >
            <BookmarkPlus className="h-3 w-3" />
            Save view
          </button>
        )}

        {saveInputVisible && (
          <div className="inline-flex items-center gap-1.5 flex-shrink-0 bg-bg-elevated border border-border rounded-lg px-2 py-1">
            <Input
              ref={saveInputRef}
              value={saveViewName}
              onChange={(e) => setSaveViewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSaveView()
                if (e.key === 'Escape') {
                  setSaveInputVisible(false)
                  setSaveViewName('')
                }
              }}
              placeholder="View name…"
              className="h-6 w-36 text-xs border-0 bg-transparent px-0 focus-visible:ring-0 focus-visible:ring-offset-0"
            />
            <label className="inline-flex items-center gap-1 text-xs text-text-secondary cursor-pointer select-none">
              <Checkbox
                checked={saveAsDefault}
                onCheckedChange={(v) => setSaveAsDefault(!!v)}
                className="h-3 w-3"
              />
              Default
            </label>
            <Button
              size="sm"
              variant="primary"
              onClick={handleSaveView}
              loading={isSaving}
              disabled={!saveViewName.trim()}
              className="h-6 px-2 text-xs"
            >
              Save
            </Button>
            <button
              onClick={() => {
                setSaveInputVisible(false)
                setSaveViewName('')
              }}
              className="text-text-tertiary hover:text-text-primary transition-colors"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </div>

      {/* Row 2 — Filter chips */}
      <div className="flex items-center gap-2 flex-wrap">
        {/* Status */}
        <MultiSelectChip
          label="Status"
          count={filters.step?.length}
          active={!!(filters.step && filters.step.length > 0)}
        >
          {STEP_OPTIONS.map((opt) => (
            <CheckItem
              key={opt.value}
              checked={filters.step?.includes(opt.value) ?? false}
              onToggle={() => toggleArrayValue('step', opt.value, filters.step)}
              colorClass={opt.color}
            >
              {opt.label}
            </CheckItem>
          ))}
        </MultiSelectChip>

        {/* Priority */}
        <MultiSelectChip
          label="Priority"
          count={filters.priority?.length}
          active={!!(filters.priority && filters.priority.length > 0)}
        >
          {PRIORITY_OPTIONS.map((opt) => (
            <CheckItem
              key={opt.value}
              checked={filters.priority?.includes(opt.value) ?? false}
              onToggle={() => toggleArrayValue('priority', opt.value, filters.priority)}
              colorClass={opt.color}
            >
              {opt.label}
            </CheckItem>
          ))}
        </MultiSelectChip>

        {/* Assignee */}
        <MultiSelectChip
          label="Assignee"
          count={filters.assignee_id?.length}
          active={!!(filters.assignee_id && filters.assignee_id.length > 0)}
        >
          {assignees.length === 0 && (
            <p className="px-2 py-1.5 text-xs text-text-tertiary">No assignees</p>
          )}
          {assignees.map((a) => (
            <CheckItem
              key={a.id}
              checked={filters.assignee_id?.includes(a.id) ?? false}
              onToggle={() => toggleArrayValue('assignee_id', a.id, filters.assignee_id)}
            >
              <span className="flex items-center gap-1.5">
                {a.avatar_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={a.avatar_url}
                    alt=""
                    className="h-4 w-4 rounded-full object-cover flex-shrink-0"
                  />
                ) : (
                  <span className="inline-flex h-4 w-4 rounded-full bg-bg-tertiary items-center justify-center text-[9px] font-semibold text-text-secondary flex-shrink-0">
                    {getInitials(a.full_name, a.email)}
                  </span>
                )}
                <span className="truncate">{a.full_name ?? a.email}</span>
              </span>
            </CheckItem>
          ))}
        </MultiSelectChip>

        {/* Labels */}
        <MultiSelectChip
          label="Labels"
          count={filters.label_ids?.length}
          active={!!(filters.label_ids && filters.label_ids.length > 0)}
        >
          {labels.length === 0 && (
            <p className="px-2 py-1.5 text-xs text-text-tertiary">No labels</p>
          )}
          {labels.map((l) => (
            <CheckItem
              key={l.id}
              checked={filters.label_ids?.includes(l.id) ?? false}
              onToggle={() => toggleArrayValue('label_ids', l.id, filters.label_ids)}
            >
              <span className="flex items-center gap-1.5">
                <span
                  className="inline-block h-2.5 w-2.5 rounded-full flex-shrink-0"
                  style={{ backgroundColor: l.color }}
                />
                <span className="truncate">{l.name}</span>
              </span>
            </CheckItem>
          ))}
        </MultiSelectChip>

        {/* Due date */}
        <Popover open={dueDateOpen} onOpenChange={setDueDateOpen}>
          <PopoverTrigger asChild>
            <button
              className={cn(
                'inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md border text-xs font-medium transition-colors whitespace-nowrap',
                dueDateActive
                  ? 'border-accent/60 bg-accent/10 text-accent'
                  : 'border-border bg-bg-secondary text-text-secondary hover:border-border-strong hover:text-text-primary'
              )}
            >
              <span>Due date</span>
              {dueDateActive && (
                <Badge className="h-4 min-w-4 px-1 text-[10px] leading-none rounded-full bg-accent/20 text-accent border-0">
                  1
                </Badge>
              )}
              <ChevronDown className="h-3 w-3 opacity-60" />
            </button>
          </PopoverTrigger>
          <PopoverContent
            className="w-56 p-1.5 bg-bg-elevated border border-border shadow-elevation-md"
            align="start"
            sideOffset={6}
          >
            {DUE_DATE_PRESETS.filter((p) => p.value !== 'custom').map((preset) => (
              <button
                key={preset.value}
                onClick={() => handleDueDatePreset(preset.value)}
                className={cn(
                  'w-full flex items-center justify-between px-2 py-1.5 rounded-sm text-xs transition-colors text-left',
                  'hover:bg-bg-tertiary',
                  dueDateMode === preset.value ? 'text-text-primary' : 'text-text-secondary'
                )}
              >
                <span>{preset.label}</span>
                {dueDateMode === preset.value && <Check className="h-3 w-3 text-accent" />}
              </button>
            ))}
            <div className="border-t border-border-subtle my-1" />
            <div className="px-2 py-1">
              <p className="text-[10px] text-text-tertiary mb-1.5 uppercase tracking-wide">
                Custom range
              </p>
              <div className="flex flex-col gap-1.5">
                <div>
                  <label className="text-[10px] text-text-tertiary mb-0.5 block">From</label>
                  <input
                    type="date"
                    value={customDueAfter ? customDueAfter.split('T')[0] : ''}
                    onChange={(e) => setCustomDueAfter(e.target.value ? new Date(e.target.value).toISOString() : '')}
                    className={cn(
                      'w-full h-6 rounded border border-border bg-bg-secondary px-1.5 text-xs text-text-primary',
                      'focus:outline-none focus:border-accent',
                      '[color-scheme:dark]'
                    )}
                  />
                </div>
                <div>
                  <label className="text-[10px] text-text-tertiary mb-0.5 block">To</label>
                  <input
                    type="date"
                    value={customDueBefore ? customDueBefore.split('T')[0] : ''}
                    onChange={(e) => setCustomDueBefore(e.target.value ? new Date(e.target.value).toISOString() : '')}
                    className={cn(
                      'w-full h-6 rounded border border-border bg-bg-secondary px-1.5 text-xs text-text-primary',
                      'focus:outline-none focus:border-accent',
                      '[color-scheme:dark]'
                    )}
                  />
                </div>
                <Button
                  size="sm"
                  variant="secondary"
                  className="h-6 text-xs w-full mt-0.5"
                  onClick={applyCustomRange}
                >
                  Apply
                </Button>
              </div>
            </div>
          </PopoverContent>
        </Popover>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Search */}
        <div className="relative flex-shrink-0">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-text-tertiary pointer-events-none" />
          <input
            type="text"
            value={filters.search ?? ''}
            onChange={(e) =>
              onFiltersChange({ ...filters, search: e.target.value || undefined })
            }
            placeholder="Search tasks…"
            className={cn(
              'h-7 w-44 rounded-md border bg-bg-secondary pl-6 pr-2 text-xs text-text-primary placeholder:text-text-tertiary',
              'focus:outline-none focus:border-accent transition-colors',
              filters.search ? 'border-accent/60' : 'border-border'
            )}
          />
          {filters.search && (
            <button
              onClick={() => onFiltersChange({ ...filters, search: undefined })}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 text-text-tertiary hover:text-text-primary transition-colors"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>

        {/* Clear all */}
        {!filtersEmpty && (
          <button
            onClick={clearAll}
            className="text-xs text-text-tertiary hover:text-text-primary transition-colors whitespace-nowrap flex-shrink-0"
          >
            Clear all
          </button>
        )}
      </div>

      {/* Row 3 — Active filter pills */}
      {activeFilterPills.length > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap">
          <Filter className="h-3 w-3 text-text-tertiary flex-shrink-0" />
          {activeFilterPills.map((pill) => (
            <span
              key={pill.key}
              className="inline-flex items-center gap-1 h-5 pl-2 pr-1 rounded-full bg-bg-tertiary border border-border text-[11px] text-text-secondary"
            >
              {pill.label}
              <button
                onClick={pill.onRemove}
                className="hover:text-text-primary transition-colors rounded-full p-0.5 hover:bg-bg-elevated"
              >
                <X className="h-2.5 w-2.5" />
              </button>
            </span>
          ))}
          <button
            onClick={clearAll}
            className="text-[11px] text-text-tertiary hover:text-danger transition-colors"
          >
            Clear
          </button>
        </div>
      )}
    </div>
  )
}
