'use client'

import * as React from 'react'
import {
  BookmarkCheck,
  ChevronDown,
  Save,
  Star,
  Trash2,
  X,
} from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { SearchInput } from '@/components/ui/search-input'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  FilterPopover,
  FilterPopoverHeader,
  FilterSection,
  FilterPill,
} from '@/components/data-table/filter-popover'
import { cn } from '@/lib/utils'
import type { OpportunityFilters } from '@/lib/pipeline/zod-schemas'
import type { PipelineSavedViewRow } from '@/app/(dashboard)/pipeline/actions'

// ─── Types ────────────────────────────────────────────────────────────────────

export type { OpportunityFilters }

export interface Stage {
  id: string
  name: string
  color: string | null
}

export interface Member {
  id: string
  full_name: string | null
  email: string
}

export interface PipelineFilterBarProps {
  filters: OpportunityFilters
  onFiltersChange: (filters: OpportunityFilters) => void
  savedViews: PipelineSavedViewRow[]
  activeViewId: string | null
  onViewSelect: (view: PipelineSavedViewRow) => void
  onViewSave: (name: string, setAsDefault: boolean) => Promise<void>
  onViewDelete: (id: string) => Promise<void>
  stages: Stage[]
  members: Member[]
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const STATUS_CONFIG = {
  open: { label: 'Open', colorClass: 'text-blue-400' },
  won: { label: 'Won', colorClass: 'text-green-400' },
  lost: { label: 'Lost', colorClass: 'text-red-400' },
} as const

type StatusValue = keyof typeof STATUS_CONFIG

function countActiveFilters(filters: OpportunityFilters): number {
  return (
    (filters.status ? 1 : 0) +
    (filters.stage_id ? 1 : 0) +
    (filters.assigned_to ? 1 : 0) +
    (filters.min_value !== undefined ? 1 : 0) +
    (filters.max_value !== undefined ? 1 : 0)
  )
}

function memberDisplayName(m: Member): string {
  return m.full_name?.trim() || m.email
}

const EMPTY_FILTERS: OpportunityFilters = {}

// ─── Component ────────────────────────────────────────────────────────────────

export function PipelineFilterBar({
  filters,
  onFiltersChange,
  savedViews,
  activeViewId,
  onViewSelect,
  onViewSave,
  onViewDelete,
  stages,
  members,
}: PipelineFilterBarProps) {
  const [search, setSearch] = React.useState(filters.q ?? '')

  // Sync local search state when filters change externally (e.g. view select)
  React.useEffect(() => {
    setSearch(filters.q ?? '')
  }, [filters.q])

  // Debounce search → filters
  React.useEffect(() => {
    const current = filters.q ?? ''
    if (current === search) return
    const timer = setTimeout(() => {
      onFiltersChange({ ...filters, q: search || undefined })
    }, 300)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search])

  const activeFilterCount = countActiveFilters(filters)
  const hasAnyFilter = activeFilterCount > 0 || !!filters.q

  function setFilter<K extends keyof OpportunityFilters>(
    key: K,
    value: OpportunityFilters[K],
  ) {
    onFiltersChange({ ...filters, [key]: value })
  }

  function clearAll() {
    setSearch('')
    onFiltersChange(EMPTY_FILTERS)
  }

  // ─── Active chip list ───────────────────────────────────────────────────────

  const activeChips: Array<{ key: string; label: string; onRemove: () => void }> =
    []

  if (filters.q) {
    activeChips.push({
      key: 'q',
      label: `Search: "${filters.q}"`,
      onRemove: () => {
        setSearch('')
        onFiltersChange({ ...filters, q: undefined })
      },
    })
  }
  if (filters.status) {
    activeChips.push({
      key: 'status',
      label: `Status: ${STATUS_CONFIG[filters.status].label}`,
      onRemove: () => setFilter('status', undefined),
    })
  }
  if (filters.stage_id) {
    const stage = stages.find((s) => s.id === filters.stage_id)
    activeChips.push({
      key: 'stage_id',
      label: `Stage: ${stage?.name ?? filters.stage_id}`,
      onRemove: () => setFilter('stage_id', undefined),
    })
  }
  if (filters.assigned_to) {
    const member = members.find((m) => m.id === filters.assigned_to)
    activeChips.push({
      key: 'assigned_to',
      label: `Assignee: ${member ? memberDisplayName(member) : filters.assigned_to}`,
      onRemove: () => setFilter('assigned_to', undefined),
    })
  }
  if (filters.min_value !== undefined || filters.max_value !== undefined) {
    const parts: string[] = []
    if (filters.min_value !== undefined) parts.push(`≥ ${filters.min_value}`)
    if (filters.max_value !== undefined) parts.push(`≤ ${filters.max_value}`)
    activeChips.push({
      key: 'value_range',
      label: `Value: ${parts.join(' ')}`,
      onRemove: () =>
        onFiltersChange({ ...filters, min_value: undefined, max_value: undefined }),
    })
  }

  // ─── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-2 px-4 sm:px-6 lg:px-8 pt-6 pb-4">
      {/* Row 1: Saved-view pills + Save view */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <SavedViewPills
          savedViews={savedViews}
          activeViewId={activeViewId}
          onSelect={onViewSelect}
          onDelete={onViewDelete}
        />
        <SaveViewPopover onSave={onViewSave} disabled={!hasAnyFilter} />
      </div>

      {/* Row 2: Filter controls */}
      <div className="animate-fade-in flex flex-row flex-nowrap items-center gap-1.5 sm:gap-2">
        {/* Search */}
        <SearchInput
          value={search}
          onValueChange={setSearch}
          onClear={() => {
            setSearch('')
            onFiltersChange({ ...filters, q: undefined })
          }}
          placeholder="Search deals..."
          containerClassName="max-w-[200px] sm:max-w-xs"
        />

        <div className="hidden sm:block flex-1" />

        <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap sm:flex-nowrap">
          {/* Status select */}
          <Select
            value={filters.status ?? 'all'}
            onValueChange={(v) =>
              setFilter('status', v === 'all' ? undefined : (v as StatusValue))
            }
          >
            <SelectTrigger className="h-8 w-auto min-w-[110px] text-[12.5px]">
              <SelectValue>
                {filters.status ? (
                  <span className={cn('font-medium', STATUS_CONFIG[filters.status].colorClass)}>
                    {STATUS_CONFIG[filters.status].label}
                  </span>
                ) : (
                  <span>Status: All</span>
                )}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Status: All</SelectItem>
              {(Object.keys(STATUS_CONFIG) as StatusValue[]).map((s) => (
                <SelectItem key={s} value={s}>
                  <span className={cn('font-medium', STATUS_CONFIG[s].colorClass)}>
                    {STATUS_CONFIG[s].label}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* More filters popover (Stage, Assignee, Value range) */}
          <PipelineMoreFilters
            filters={filters}
            onFiltersChange={onFiltersChange}
            stages={stages}
            members={members}
            activeCount={activeFilterCount}
          />
        </div>
      </div>

      {/* Row 3: Active filter chips */}
      {activeChips.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {activeChips.map((chip) => (
            <FilterChip
              key={chip.key}
              label={chip.label}
              onRemove={chip.onRemove}
            />
          ))}
          {activeChips.length > 1 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={clearAll}
              className="h-6 px-2 text-[11px] text-text-tertiary hover:text-text-primary"
            >
              Clear all
            </Button>
          )}
        </div>
      )}
    </div>
  )
}

// ─── SavedViewPills ────────────────────────────────────────────────────────────

function SavedViewPills({
  savedViews,
  activeViewId,
  onSelect,
  onDelete,
}: {
  savedViews: PipelineSavedViewRow[]
  activeViewId: string | null
  onSelect: (view: PipelineSavedViewRow) => void
  onDelete: (id: string) => Promise<void>
}) {
  if (savedViews.length === 0) return null

  return (
    <>
      {savedViews.map((view) => {
        const isActive = view.id === activeViewId
        return (
          <DropdownMenu key={view.id}>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className={cn(
                  'inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-[12px] font-medium transition-colors',
                  isActive
                    ? 'border-accent/50 bg-accent-muted/30 text-accent'
                    : 'border-border-subtle bg-bg-secondary text-text-secondary hover:border-border-strong hover:bg-bg-tertiary',
                )}
              >
                {view.is_default && (
                  <Star
                    className={cn(
                      'h-3 w-3',
                      isActive ? 'fill-accent text-accent' : 'fill-text-tertiary text-text-tertiary',
                    )}
                  />
                )}
                <span>{view.name}</span>
                <ChevronDown className="h-3 w-3 opacity-60" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-44">
              <DropdownMenuItem onClick={() => onSelect(view)}>
                <BookmarkCheck className="h-3.5 w-3.5 mr-2" />
                Apply view
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onClick={async () => {
                  try {
                    await onDelete(view.id)
                    toast.success('View deleted')
                  } catch {
                    toast.error('Failed to delete view')
                  }
                }}
              >
                <Trash2 className="h-3.5 w-3.5 mr-2" />
                Delete view
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )
      })}
    </>
  )
}

// ─── SaveViewPopover ───────────────────────────────────────────────────────────

function SaveViewPopover({
  onSave,
  disabled,
}: {
  onSave: (name: string, setAsDefault: boolean) => Promise<void>
  disabled: boolean
}) {
  const [open, setOpen] = React.useState(false)
  const [name, setName] = React.useState('')
  const [setAsDefault, setSetAsDefault] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const inputRef = React.useRef<HTMLInputElement>(null)

  React.useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 50)
    } else {
      setName('')
      setSetAsDefault(false)
    }
  }, [open])

  async function handleSave() {
    const trimmed = name.trim()
    if (!trimmed) {
      inputRef.current?.focus()
      return
    }
    setSaving(true)
    try {
      await onSave(trimmed, setAsDefault)
      toast.success('View saved')
      setOpen(false)
    } catch {
      toast.error('Failed to save view')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="secondary"
          size="sm"
          className="h-7 gap-1.5 text-[12px]"
          disabled={disabled}
          title={disabled ? 'Set at least one filter to save a view' : undefined}
        >
          <Save className="h-3 w-3" />
          Save view
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-4 space-y-3">
        <p className="text-[13px] font-semibold text-text-primary">Save current view</p>
        <div className="space-y-1.5">
          <label htmlFor="view-name" className="text-xs text-text-secondary">
            View name
          </label>
          <Input
            id="view-name"
            ref={inputRef}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. My open deals"
            className="h-8 text-[12.5px]"
            onKeyDown={(e) => {
              if (e.key === 'Enter') void handleSave()
              if (e.key === 'Escape') setOpen(false)
            }}
          />
        </div>
        <label className="flex items-center gap-2 cursor-pointer select-none">
          <Checkbox
            id="view-default"
            checked={setAsDefault}
            onCheckedChange={(v) => setSetAsDefault(!!v)}
          />
          <span className="text-[12.5px] text-text-secondary">Set as default view</span>
        </label>
        <div className="flex justify-end gap-2 pt-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-[12px]"
            onClick={() => setOpen(false)}
          >
            Cancel
          </Button>
          <Button
            size="sm"
            className="h-7 text-[12px]"
            onClick={() => void handleSave()}
            disabled={saving || !name.trim()}
          >
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}

// ─── PipelineMoreFilters ───────────────────────────────────────────────────────

function PipelineMoreFilters({
  filters,
  onFiltersChange,
  stages,
  members,
  activeCount,
}: {
  filters: OpportunityFilters
  onFiltersChange: (f: OpportunityFilters) => void
  stages: Stage[]
  members: Member[]
  activeCount: number
}) {
  const [minStr, setMinStr] = React.useState(
    filters.min_value !== undefined ? String(filters.min_value) : '',
  )
  const [maxStr, setMaxStr] = React.useState(
    filters.max_value !== undefined ? String(filters.max_value) : '',
  )

  // Sync local value inputs when filters are reset externally
  React.useEffect(() => {
    setMinStr(filters.min_value !== undefined ? String(filters.min_value) : '')
  }, [filters.min_value])

  React.useEffect(() => {
    setMaxStr(filters.max_value !== undefined ? String(filters.max_value) : '')
  }, [filters.max_value])

  function applyValueRange() {
    const min = minStr !== '' && !isNaN(Number(minStr)) ? Number(minStr) : undefined
    const max = maxStr !== '' && !isNaN(Number(maxStr)) ? Number(maxStr) : undefined
    onFiltersChange({ ...filters, min_value: min, max_value: max })
  }

  function clearAll() {
    setMinStr('')
    setMaxStr('')
    onFiltersChange({
      ...filters,
      stage_id: undefined,
      assigned_to: undefined,
      min_value: undefined,
      max_value: undefined,
    })
  }

  return (
    <FilterPopover activeCount={activeCount}>
      <FilterPopoverHeader
        title="Pipeline filters"
        showClear={activeCount > 0}
        onClear={clearAll}
      />
      <div className="space-y-5 p-4">
        {/* Stage */}
        {stages.length > 0 && (
          <FilterSection title="Stage">
            <FilterPill
              active={!filters.stage_id}
              onClick={() => onFiltersChange({ ...filters, stage_id: undefined })}
            >
              All stages
            </FilterPill>
            {stages.map((stage) => (
              <FilterPill
                key={stage.id}
                active={filters.stage_id === stage.id}
                onClick={() =>
                  onFiltersChange({ ...filters, stage_id: stage.id })
                }
              >
                {stage.color && (
                  <span
                    className="mr-1.5 inline-block h-2 w-2 rounded-full"
                    style={{ backgroundColor: stage.color }}
                  />
                )}
                {stage.name}
              </FilterPill>
            ))}
          </FilterSection>
        )}

        {/* Assignee */}
        {members.length > 0 && (
          <FilterSection title="Assignee">
            <FilterPill
              active={!filters.assigned_to}
              onClick={() =>
                onFiltersChange({ ...filters, assigned_to: undefined })
              }
            >
              Anyone
            </FilterPill>
            {members.map((m) => (
              <FilterPill
                key={m.id}
                active={filters.assigned_to === m.id}
                onClick={() =>
                  onFiltersChange({ ...filters, assigned_to: m.id })
                }
              >
                {memberDisplayName(m)}
              </FilterPill>
            ))}
          </FilterSection>
        )}

        {/* Value range */}
        <FilterSection title="Deal value">
          <div className="flex items-center gap-2 w-full">
            <Input
              type="number"
              min={0}
              placeholder="Min"
              value={minStr}
              onChange={(e) => setMinStr(e.target.value)}
              onBlur={applyValueRange}
              onKeyDown={(e) => e.key === 'Enter' && applyValueRange()}
              className="h-8 text-[12px] w-[90px]"
            />
            <span className="text-text-tertiary text-xs">–</span>
            <Input
              type="number"
              min={0}
              placeholder="Max"
              value={maxStr}
              onChange={(e) => setMaxStr(e.target.value)}
              onBlur={applyValueRange}
              onKeyDown={(e) => e.key === 'Enter' && applyValueRange()}
              className="h-8 text-[12px] w-[90px]"
            />
          </div>
        </FilterSection>
      </div>
    </FilterPopover>
  )
}

// ─── FilterChip ────────────────────────────────────────────────────────────────

function FilterChip({
  label,
  onRemove,
}: {
  label: string
  onRemove: () => void
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border border-border-subtle bg-bg-secondary',
        'px-2.5 py-0.5 text-[11.5px] font-medium text-text-secondary',
      )}
    >
      {label}
      <button
        type="button"
        onClick={onRemove}
        className="ml-0.5 rounded-full p-0.5 text-text-tertiary hover:bg-bg-tertiary hover:text-text-primary transition-colors"
        aria-label={`Remove ${label} filter`}
      >
        <X className="h-3 w-3" />
      </button>
    </span>
  )
}
