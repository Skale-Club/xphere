'use client'

/**
 * Advanced filter panel for the conversation inbox (SEED-035).
 *
 * Rendered inside a Popover from the conversation-list header. Exposes
 * checkbox-style groups for status, priority, bot state, assigned user,
 * labels, and "other" toggles (starred, pinned, unread). On any change,
 * fires `onChange` with the full `AdvancedFilters` shape | parent decides
 * how/when to translate into the API query.
 */

import { useEffect, useState } from 'react'
import { Filter, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Separator } from '@/components/ui/separator'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'
import type { OrgMember } from '@/app/(dashboard)/chat/actions'

export interface AdvancedFilters {
  statuses: string[]
  priorities: string[]
  botStatuses: string[]
  assignedUserIds: string[] // 'unassigned' encoded as a sentinel value
  labelIds: string[]
  starred: boolean
  pinned: boolean
  unread: boolean
}

export const EMPTY_FILTERS: AdvancedFilters = {
  statuses: [],
  priorities: [],
  botStatuses: [],
  assignedUserIds: [],
  labelIds: [],
  starred: false,
  pinned: false,
  unread: false,
}

interface FilterPanelProps {
  value: AdvancedFilters
  onChange: (next: AdvancedFilters) => void
  members: OrgMember[]
  labels: Array<{ id: string; name: string; color: string }>
}

const STATUSES: Array<{ value: string; label: string; tone: string }> = [
  { value: 'open', label: 'Open', tone: 'bg-blue-500' },
  { value: 'pending', label: 'Pending', tone: 'bg-yellow-500' },
  { value: 'waiting', label: 'Waiting', tone: 'bg-purple-500' },
  { value: 'resolved', label: 'Resolved', tone: 'bg-emerald-500' },
  { value: 'closed', label: 'Archived', tone: 'bg-slate-400' },
]

const PRIORITIES: Array<{ value: string; label: string; dot?: string }> = [
  { value: 'urgent', label: 'Urgent', dot: 'bg-rose-500' },
  { value: 'high', label: 'High', dot: 'bg-amber-500' },
  { value: 'normal', label: 'Normal' },
]

const BOT_STATUSES: Array<{ value: string; label: string }> = [
  { value: 'active', label: 'Bot active' },
  { value: 'paused', label: 'Bot paused' },
]

export function countActiveFilters(f: AdvancedFilters): number {
  return (
    f.statuses.length +
    f.priorities.length +
    f.botStatuses.length +
    f.assignedUserIds.length +
    f.labelIds.length +
    (f.starred ? 1 : 0) +
    (f.pinned ? 1 : 0) +
    (f.unread ? 1 : 0)
  )
}

export function FilterPanel({ value, onChange, members, labels }: FilterPanelProps) {
  const [open, setOpen] = useState(false)
  const [local, setLocal] = useState<AdvancedFilters>(value)
  // SEED-040: detect mobile breakpoint client-side so we can swap Popover
  // (desktop) for Sheet (mobile). Defaults to false so SSR + first paint match
  // desktop, then we re-evaluate on mount.
  const [isMobile, setIsMobile] = useState(false)
  useEffect(() => {
    if (typeof window === 'undefined') return
    const mq = window.matchMedia('(max-width: 767px)')
    const update = () => setIsMobile(mq.matches)
    update()
    mq.addEventListener('change', update)
    return () => mq.removeEventListener('change', update)
  }, [])

  // Sync down when value changes externally (e.g. reset).
  useEffect(() => {
    setLocal(value)
  }, [value])

  const activeCount = countActiveFilters(local)

  const toggle = (key: keyof AdvancedFilters, v: string) => {
    setLocal((prev) => {
      const arr = prev[key] as string[]
      const next = arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]
      const updated = { ...prev, [key]: next }
      onChange(updated)
      return updated
    })
  }

  const toggleBool = (key: 'starred' | 'pinned' | 'unread') => {
    setLocal((prev) => {
      const updated = { ...prev, [key]: !prev[key] }
      onChange(updated)
      return updated
    })
  }

  const clearAll = () => {
    setLocal(EMPTY_FILTERS)
    onChange(EMPTY_FILTERS)
  }

  // SEED-040: shared body | rendered inside Popover (desktop) and Sheet (mobile).
  const body = (
    <>
      <div className="flex items-center justify-between border-b border-border-subtle px-3 py-2">
        <span className="text-[12px] font-semibold text-text-primary">Filters</span>
        {activeCount > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-[11px]"
            onClick={clearAll}
          >
            <X className="h-3 w-3 mr-1" /> Clear all
          </Button>
        )}
      </div>
      <ScrollArea className="max-h-[420px] md:max-h-[420px]">
        <div className="p-3 space-y-4">
            <FilterGroup title="Status">
              {STATUSES.map((s) => (
                <FilterCheckbox
                  key={s.value}
                  id={`status-${s.value}`}
                  checked={local.statuses.includes(s.value)}
                  onChange={() => toggle('statuses', s.value)}
                  label={
                    <span className="inline-flex items-center gap-2">
                      <span className={cn('h-2 w-2 rounded-full', s.tone)} />
                      {s.label}
                    </span>
                  }
                />
              ))}
            </FilterGroup>

            <Separator />

            <FilterGroup title="Priority">
              {PRIORITIES.map((p) => (
                <FilterCheckbox
                  key={p.value}
                  id={`priority-${p.value}`}
                  checked={local.priorities.includes(p.value)}
                  onChange={() => toggle('priorities', p.value)}
                  label={
                    <span className="inline-flex items-center gap-2">
                      {p.dot ? (
                        <span className={cn('h-2 w-2 rounded-full', p.dot)} />
                      ) : (
                        <span className="h-2 w-2" />
                      )}
                      {p.label}
                    </span>
                  }
                />
              ))}
            </FilterGroup>

            <Separator />

            <FilterGroup title="Bot">
              {BOT_STATUSES.map((b) => (
                <FilterCheckbox
                  key={b.value}
                  id={`bot-${b.value}`}
                  checked={local.botStatuses.includes(b.value)}
                  onChange={() => toggle('botStatuses', b.value)}
                  label={b.label}
                />
              ))}
            </FilterGroup>

            <Separator />

            <FilterGroup title="Assigned to">
              <FilterCheckbox
                id="assigned-unassigned"
                checked={local.assignedUserIds.includes('unassigned')}
                onChange={() => toggle('assignedUserIds', 'unassigned')}
                label="Unassigned"
              />
              {members.map((m) => (
                <FilterCheckbox
                  key={m.userId}
                  id={`assigned-${m.userId}`}
                  checked={local.assignedUserIds.includes(m.userId)}
                  onChange={() => toggle('assignedUserIds', m.userId)}
                  label={m.displayName ?? m.email ?? m.userId}
                />
              ))}
            </FilterGroup>

            {labels.length > 0 && (
              <>
                <Separator />
                <FilterGroup title="Labels">
                  {labels.map((l) => (
                    <FilterCheckbox
                      key={l.id}
                      id={`label-${l.id}`}
                      checked={local.labelIds.includes(l.id)}
                      onChange={() => toggle('labelIds', l.id)}
                      label={
                        <span className="inline-flex items-center gap-2">
                          <span
                            className="h-2 w-2 rounded-full"
                            style={{ backgroundColor: l.color }}
                          />
                          {l.name}
                        </span>
                      }
                    />
                  ))}
                </FilterGroup>
              </>
            )}

            <Separator />

            <FilterGroup title="Other">
              <FilterCheckbox
                id="other-starred"
                checked={local.starred}
                onChange={() => toggleBool('starred')}
                label="Starred"
              />
              <FilterCheckbox
                id="other-pinned"
                checked={local.pinned}
                onChange={() => toggleBool('pinned')}
                label="Pinned"
              />
              <FilterCheckbox
                id="other-unread"
                checked={local.unread}
                onChange={() => toggleBool('unread')}
                label="Unread"
              />
            </FilterGroup>
          </div>
        </ScrollArea>
      </>
  )

  const triggerClass = cn(
    'relative inline-flex h-7 w-7 items-center justify-center rounded-[6px] transition-colors',
    activeCount > 0
      ? 'bg-accent-muted text-accent ring-1 ring-accent/30'
      : 'bg-bg-tertiary/50 text-text-secondary hover:bg-bg-tertiary hover:text-text-primary',
  )
  const triggerInner = (
    <>
      <Filter className="h-3.5 w-3.5" />
      {activeCount > 0 && (
        <span className="absolute -top-1 -right-1 h-4 min-w-[16px] px-1 rounded-full bg-accent text-white text-[9px] font-semibold leading-4 text-center">
          {activeCount}
        </span>
      )}
    </>
  )

  // SEED-040: render a bottom Sheet on mobile so the filter UI fills the
  // viewport ergonomically, and a Popover on md+ where the original anchored
  // popover pattern is more space-efficient.
  if (isMobile) {
    return (
      <>
        <button
          type="button"
          aria-label="Advanced filters"
          title="Advanced filters"
          className={triggerClass}
          onClick={() => setOpen(true)}
        >
          {triggerInner}
        </button>
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetContent
            side="bottom"
            className="max-h-[85vh] overflow-hidden p-0 pb-safe rounded-t-[16px]"
          >
            <SheetHeader className="px-4 pt-3 pb-1">
              <SheetTitle className="text-[13px] font-semibold text-text-primary">
                Filters
              </SheetTitle>
            </SheetHeader>
            {body}
          </SheetContent>
        </Sheet>
      </>
    )
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Advanced filters"
          title="Advanced filters"
          className={triggerClass}
        >
          {triggerInner}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[320px] p-0">
        {body}
      </PopoverContent>
    </Popover>
  )
}

function FilterGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1.5 text-[10.5px] font-medium uppercase tracking-[0.08em] text-text-tertiary">
        {title}
      </div>
      <div className="space-y-1">{children}</div>
    </div>
  )
}

function FilterCheckbox({
  id,
  checked,
  onChange,
  label,
}: {
  id: string
  checked: boolean
  onChange: () => void
  label: React.ReactNode
}) {
  return (
    <label
      htmlFor={id}
      className="flex cursor-pointer items-center gap-2 rounded-[5px] px-1.5 py-1 text-[12px] text-text-primary hover:bg-bg-tertiary/60"
    >
      <Checkbox
        id={id}
        checked={checked}
        onCheckedChange={() => onChange()}
        className="h-3.5 w-3.5"
      />
      <span className="min-w-0 truncate">{label}</span>
    </label>
  )
}
