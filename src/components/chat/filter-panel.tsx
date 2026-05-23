'use client'

/**
 * Conversation inbox filters.
 *
 * Search stays outside this panel. Everything else that narrows the inbox
 * lives here so the header remains calm and the filter hierarchy is explicit.
 */

import { useEffect, useState } from 'react'
import { Filter, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Separator } from '@/components/ui/separator'
import { ScrollArea } from '@/components/ui/scroll-area'
import { ChannelBadge, type Channel } from '@/components/design-system/channel-badge'
import { cn } from '@/lib/utils'
import type { OrgMember } from '@/app/(dashboard)/chat/actions'

export type InboxViewFilter = 'all' | 'unread' | 'mine'

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
  viewFilter: InboxViewFilter
  onViewFilterChange: (next: InboxViewFilter) => void
  selectedChannels: Set<Channel>
  onSelectedChannelsChange: (next: Set<Channel>) => void
  members: OrgMember[]
  labels: Array<{ id: string; name: string; color: string }>
  allowMine: boolean
}

const VIEW_FILTERS: Array<{ value: InboxViewFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'unread', label: 'Unread' },
  { value: 'mine', label: 'Mine' },
]

const CHANNELS: Array<{ value: Exclude<Channel, 'unknown'>; label: string }> = [
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'instagram', label: 'Instagram' },
  { value: 'messenger', label: 'Messenger' },
  { value: 'sms', label: 'SMS' },
  { value: 'voice', label: 'Voice' },
  { value: 'email', label: 'Email' },
  { value: 'web', label: 'Web' },
]

const channelBg: Record<Exclude<Channel, 'unknown'>, string> = {
  whatsapp:  'bg-[var(--ch-whatsapp)]/30',
  instagram: 'bg-[var(--ch-instagram)]/30',
  messenger: 'bg-[var(--ch-messenger)]/30',
  sms:      'bg-[var(--ch-sms)]/30',
  voice:    'bg-[var(--ch-voice)]/30',
  email:    'bg-[var(--ch-email)]/30',
  web:      'bg-[var(--ch-web)]/30',
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
    (f.pinned ? 1 : 0)
  )
}

function countAllActiveFilters(
  filters: AdvancedFilters,
  viewFilter: InboxViewFilter,
  selectedChannels: Set<Channel>,
) {
  return countActiveFilters(filters) +
    (viewFilter !== 'all' ? 1 : 0) +
    selectedChannels.size
}

export function FilterPanel({
  value,
  onChange,
  viewFilter,
  onViewFilterChange,
  selectedChannels,
  onSelectedChannelsChange,
  members,
  labels,
  allowMine,
}: FilterPanelProps) {
  const [open, setOpen] = useState(false)
  const [local, setLocal] = useState<AdvancedFilters>(value)
  const [isMobile, setIsMobile] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined') return
    const mq = window.matchMedia('(max-width: 767px)')
    const update = () => setIsMobile(mq.matches)
    update()
    mq.addEventListener('change', update)
    return () => mq.removeEventListener('change', update)
  }, [])

  useEffect(() => {
    setLocal(value)
  }, [value])

  const activeCount = countAllActiveFilters(local, viewFilter, selectedChannels)

  const toggle = (key: keyof AdvancedFilters, v: string) => {
    setLocal((prev) => {
      const arr = prev[key] as string[]
      const next = arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]
      const updated = { ...prev, [key]: next }
      onChange(updated)
      return updated
    })
  }

  const toggleBool = (key: 'starred' | 'pinned') => {
    setLocal((prev) => {
      const updated = { ...prev, [key]: !prev[key] }
      onChange(updated)
      return updated
    })
  }

  const toggleChannel = (channel: Channel) => {
    const next = new Set(selectedChannels)
    if (next.has(channel)) next.delete(channel)
    else next.add(channel)
    onSelectedChannelsChange(next)
  }

  const clearAll = () => {
    setLocal(EMPTY_FILTERS)
    onChange(EMPTY_FILTERS)
    onViewFilterChange('all')
    onSelectedChannelsChange(new Set())
  }

  const body = (
    <>
      <div className="flex items-center justify-between border-b border-border-subtle px-3.5 py-3">
        <div className="min-w-0">
          <div className="text-[12.5px] font-semibold text-text-primary">Filters</div>
          <div className="mt-0.5 text-[10.5px] text-text-tertiary">
            {activeCount > 0 ? `${activeCount} active` : 'No filters applied'}
          </div>
        </div>
        {activeCount > 0 && (
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-[11px] text-text-secondary hover:text-text-primary"
              onClick={clearAll}
            >
              <X className="mr-1 h-3 w-3" /> Clear
            </Button>
            <Button
              variant="default"
              size="sm"
              className="h-7 px-2 text-[11px]"
              onClick={() => setOpen(false)}
            >
              Done
            </Button>
          </div>
        )}
      </div>

      <ScrollArea className="h-[min(460px,calc(100vh-150px))]">
        <div className="space-y-4 p-3.5">
          <FilterGroup title="View" description="Choose the primary inbox slice.">
            <div className="grid grid-cols-3 gap-1 rounded-[8px] border border-border-subtle bg-bg-primary p-1">
              {VIEW_FILTERS.filter((v) => allowMine || v.value !== 'mine').map((v) => {
                const active = viewFilter === v.value
                return (
                  <button
                    key={v.value}
                    type="button"
                    onClick={() => onViewFilterChange(v.value)}
                    className={cn(
                      'h-7 rounded-[6px] px-2 text-[11.5px] font-medium transition-colors',
                      active
                        ? 'bg-accent-muted text-accent ring-1 ring-accent/25'
                        : 'text-text-secondary hover:bg-bg-tertiary hover:text-text-primary',
                    )}
                  >
                    {v.label}
                  </button>
                )
              })}
            </div>
          </FilterGroup>

          <FilterGroup title="Channels">
            <div className="flex flex-wrap items-center justify-start gap-1">
              {CHANNELS.map((channel) => {
                const active = selectedChannels.has(channel.value)
                return (
                  <button
                    key={channel.value}
                    type="button"
                    title={channel.label}
                    aria-label={`Filter by ${channel.label}`}
                    aria-pressed={active}
                    onClick={() => toggleChannel(channel.value)}
                    className={cn(
                      'flex h-[31px] w-[31px] items-center justify-center rounded-[7px]',
                      active ? channelBg[channel.value] : 'opacity-50',
                    )}
                  >
                    <ChannelBadge channel={channel.value} showLabel={false} size="md" className="!h-[31px] !w-[31px] ring-0" />
                  </button>
                )
              })}
            </div>
          </FilterGroup>

          <Separator />

          <FilterGroup title="Status">
            <div className="grid grid-cols-2 gap-1">
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
            </div>
          </FilterGroup>

          <Separator />

          <FilterGroup title="Assignment">
            <div className="space-y-1">
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
            </div>
          </FilterGroup>

          <Separator />

          <div className="grid grid-cols-2 gap-4">
            <FilterGroup title="Priority">
              <div className="space-y-1">
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
              </div>
            </FilterGroup>

            <FilterGroup title="Bot">
              <div className="space-y-1">
                {BOT_STATUSES.map((b) => (
                  <FilterCheckbox
                    key={b.value}
                    id={`bot-${b.value}`}
                    checked={local.botStatuses.includes(b.value)}
                    onChange={() => toggle('botStatuses', b.value)}
                    label={b.label}
                  />
                ))}
              </div>
            </FilterGroup>
          </div>

          {labels.length > 0 && (
            <>
              <Separator />
              <FilterGroup title="Labels">
                <div className="space-y-1">
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
                </div>
              </FilterGroup>
            </>
          )}

          <Separator />

          <FilterGroup title="Flags">
            <div className="grid grid-cols-2 gap-1">
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
            </div>
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
        <span className="absolute -right-1 -top-1 h-4 min-w-[16px] rounded-full bg-accent px-1 text-center text-[9px] font-semibold leading-4 text-white">
          {activeCount}
        </span>
      )}
    </>
  )

  if (isMobile) {
    return (
      <>
        <button
          type="button"
          aria-label="Conversation filters"
          title="Conversation filters"
          className={triggerClass}
          onClick={() => setOpen(true)}
        >
          {triggerInner}
        </button>
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetContent
            side="bottom"
            className="max-h-[85vh] overflow-hidden rounded-t-[16px] p-0 pb-safe"
          >
            <SheetHeader className="px-4 pb-1 pt-3">
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
          aria-label="Conversation filters"
          title="Conversation filters"
          className={triggerClass}
        >
          {triggerInner}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[350px] overflow-hidden p-0">
        {body}
      </PopoverContent>
    </Popover>
  )
}

function FilterGroup({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children: React.ReactNode
}) {
  return (
    <div>
      <div className="mb-2">
        <div className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-text-tertiary">
          {title}
        </div>
        {description && (
          <div className="mt-0.5 text-[10.5px] leading-snug text-text-tertiary/80">
            {description}
          </div>
        )}
      </div>
      {children}
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
      className={cn(
        'flex min-w-0 cursor-pointer items-center gap-2 rounded-[6px] px-1.5 py-1.5 text-[12px] transition-colors',
        checked
          ? 'bg-accent-muted/50 text-text-primary'
          : 'text-text-secondary hover:bg-bg-tertiary/60 hover:text-text-primary',
      )}
    >
      <Checkbox
        id={id}
        checked={checked}
        onCheckedChange={() => onChange()}
        className="h-3.5 w-3.5 shrink-0"
      />
      <span className="min-w-0 truncate">{label}</span>
    </label>
  )
}
