'use client'

/**
 * Conversation inbox filters.
 *
 * Search stays outside this panel. Everything else that narrows the inbox
 * lives here so the header remains calm and the filter hierarchy is explicit.
 */

import { useEffect, useState } from 'react'
import { Filter, X, Check, Star, Pin, Play, Pause, CheckCircle2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { ChannelBadge, type Channel } from '@/components/design-system/channel-badge'
import { cn } from '@/lib/utils'
import { formatEmailDisplay } from '@/lib/email-addresses/format'
import type { OrgMember } from '@/app/(dashboard)/chat/actions'

export type InboxViewFilter = 'all' | 'unread' | 'mine'

export interface AdvancedFilters {
  statuses: string[]
  priorities: string[]
  botStatuses: string[]
  assignedUserIds: string[] // 'unassigned' encoded as a sentinel value
  labelIds: string[]
  phoneNumberIds: string[]
  starred: boolean
  pinned: boolean
  unread: boolean
  verified: boolean
}

export const EMPTY_FILTERS: AdvancedFilters = {
  statuses: [],
  priorities: [],
  botStatuses: [],
  assignedUserIds: [],
  labelIds: [],
  phoneNumberIds: [],
  starred: false,
  pinned: false,
  unread: false,
  verified: false,
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
  phoneNumbers?: Array<{ id: string; label: string; e164: string }>
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
  { value: 'direct', label: 'Direct' },
]

const channelSelectedBg: Record<Exclude<Channel, 'unknown'>, string> = {
  whatsapp:  '!bg-[var(--ch-whatsapp)]/50',
  instagram: '!bg-[var(--ch-instagram)]/50',
  messenger: '!bg-[var(--ch-messenger)]/50',
  sms:       '!bg-[var(--ch-sms)]/50',
  voice:     '!bg-[var(--ch-voice)]/50',
  email:     '!bg-[var(--ch-email)]/50',
  web:       '!bg-[var(--ch-web)]/50',
  direct:    '!bg-bg-tertiary',
}

const STATUSES: Array<{ value: string; label: string; tone: string; activeClass?: string }> = [
  { value: 'open', label: 'Open', tone: 'bg-blue-500', activeClass: 'border-blue-500/40 bg-blue-500/15 text-blue-300' },
  { value: 'pending', label: 'Pending', tone: 'bg-yellow-500', activeClass: 'border-yellow-500/40 bg-yellow-500/15 text-yellow-300' },
  { value: 'waiting', label: 'Waiting', tone: 'bg-purple-500', activeClass: 'border-purple-500/40 bg-purple-500/15 text-purple-300' },
  { value: 'resolved', label: 'Resolved', tone: 'bg-emerald-500', activeClass: 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300' },
  { value: 'closed', label: 'Archived', tone: 'bg-slate-400', activeClass: 'border-slate-400/40 bg-slate-400/15 text-slate-300' },
]

const PRIORITIES: Array<{ value: string; label: string; dot?: string; activeClass?: string }> = [
  { value: 'urgent', label: 'Urgent', dot: 'bg-rose-500', activeClass: 'border-rose-500/40 bg-rose-500/15 text-rose-300' },
  { value: 'high', label: 'High', dot: 'bg-amber-500', activeClass: 'border-amber-500/40 bg-amber-500/15 text-amber-300' },
  { value: 'normal', label: 'Normal' },
]

const BOT_STATUSES: Array<{
  value: string
  label: string
  icon: React.ComponentType<{ className?: string }>
  activeClass: string
}> = [
  {
    value: 'active',
    label: 'Active',
    icon: Play,
    activeClass: 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300',
  },
  {
    value: 'paused',
    label: 'Paused',
    icon: Pause,
    activeClass: 'border-amber-500/40 bg-amber-500/15 text-amber-300',
  },
]

export function countActiveFilters(f: AdvancedFilters): number {
  return (
    f.statuses.length +
    f.priorities.length +
    f.botStatuses.length +
    f.assignedUserIds.length +
    f.labelIds.length +
    f.phoneNumberIds.length +
    (f.starred ? 1 : 0) +
    (f.pinned ? 1 : 0) +
    (f.verified ? 1 : 0)
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
  phoneNumbers = [],
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
    const arr = local[key] as string[]
    const next = arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]
    const updated = { ...local, [key]: next }
    setLocal(updated)
    onChange(updated)
  }

  const toggleBool = (key: 'starred' | 'pinned' | 'verified') => {
    const updated = { ...local, [key]: !local[key] }
    setLocal(updated)
    onChange(updated)
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
    <div className="flex h-full max-h-[min(620px,calc(100vh-100px))] flex-col">
      {/* Header — sticky */}
      <div className="flex shrink-0 items-center justify-between border-b border-border-subtle px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-semibold text-text-primary">Filters</span>
          {activeCount > 0 && (
            <span className="inline-flex h-4 min-w-[16px] items-center justify-center rounded-full bg-accent px-1 text-[10px] font-semibold text-white">
              {activeCount}
            </span>
          )}
        </div>
        {activeCount > 0 && (
          <button
            type="button"
            onClick={clearAll}
            className="inline-flex items-center gap-1 rounded-[6px] px-1.5 py-1 text-[11px] text-text-tertiary transition-colors hover:bg-bg-tertiary hover:text-text-primary"
          >
            <X className="h-3 w-3" /> Clear all
          </button>
        )}
      </div>

      {/* Body — scroll */}
      <div className="flex-1 overflow-y-auto">
        <div className="space-y-5 p-4">
          {/* View */}
          <Section title="View">
            <div className="flex gap-1 rounded-[8px] bg-bg-tertiary/40 p-0.5">
              {VIEW_FILTERS.filter((v) => allowMine || v.value !== 'mine').map((v) => {
                const active = viewFilter === v.value
                return (
                  <button
                    key={v.value}
                    type="button"
                    onClick={() => onViewFilterChange(v.value)}
                    className={cn(
                      'flex-1 h-7 rounded-[6px] text-[12px] font-medium transition-all',
                      active
                        ? 'bg-bg-primary text-text-primary shadow-sm ring-1 ring-border-subtle'
                        : 'text-text-tertiary hover:text-text-primary',
                    )}
                  >
                    {v.label}
                  </button>
                )
              })}
            </div>
          </Section>

          {/* Channels */}
          <Section title="Channels">
            <div className="flex flex-wrap gap-1.5">
              {CHANNELS.map((channel) => {
                const active = selectedChannels.has(channel.value)
                return (
                  <button
                    key={channel.value}
                    type="button"
                    title={channel.label}
                    aria-label={channel.label}
                    aria-pressed={active}
                    onClick={() => toggleChannel(channel.value)}
                    className={cn(
                      'relative flex h-8 w-8 items-center justify-center rounded-[7px] transition-all',
                      active
                        ? 'opacity-100'
                        : 'opacity-40 hover:opacity-100',
                    )}
                  >
                    <ChannelBadge
                      channel={channel.value}
                      showLabel={false}
                      size="md"
                      className={cn(
                        '!h-8 !w-8 ring-0',
                        active && channelSelectedBg[channel.value],
                      )}
                    />
                  </button>
                )
              })}
            </div>
          </Section>

          {/* Status */}
          <Section title="Status">
            <div className="flex flex-wrap gap-1.5">
              {STATUSES.map((s) => (
                <FilterChip
                  key={s.value}
                  checked={local.statuses.includes(s.value)}
                  onClick={() => toggle('statuses', s.value)}
                  dot={s.tone}
                  activeClass={s.activeClass}
                >
                  {s.label}
                </FilterChip>
              ))}
            </div>
          </Section>

          {/* Priority */}
          <Section title="Priority">
            <div className="flex flex-wrap gap-1.5">
              {PRIORITIES.map((p) => (
                <FilterChip
                  key={p.value}
                  checked={local.priorities.includes(p.value)}
                  onClick={() => toggle('priorities', p.value)}
                  dot={p.dot}
                  activeClass={p.activeClass}
                >
                  {p.label}
                </FilterChip>
              ))}
            </div>
          </Section>

          {/* Bot */}
          <Section title="Bot">
            <div className="flex flex-wrap gap-1.5">
              {BOT_STATUSES.map((b) => (
                <FilterChip
                  key={b.value}
                  checked={local.botStatuses.includes(b.value)}
                  onClick={() => toggle('botStatuses', b.value)}
                  icon={b.icon}
                  activeClass={b.activeClass}
                >
                  {b.label}
                </FilterChip>
              ))}
            </div>
          </Section>

          {/* Assignment */}
          <Section title="Assignment">
            <div className="flex flex-wrap gap-1.5">
              <FilterChip
                checked={local.assignedUserIds.includes('unassigned')}
                onClick={() => toggle('assignedUserIds', 'unassigned')}
              >
                Unassigned
              </FilterChip>
              {members.map((m) => (
                <FilterChip
                  key={m.userId}
                  checked={local.assignedUserIds.includes(m.userId)}
                  onClick={() => toggle('assignedUserIds', m.userId)}
                >
                  {m.displayName ?? (formatEmailDisplay(m.email) || m.userId)}
                </FilterChip>
              ))}
            </div>
          </Section>

          {/* Labels */}
          {labels.length > 0 && (
            <Section title="Labels">
              <div className="flex flex-wrap gap-1.5">
                {labels.map((l) => (
                  <FilterChip
                    key={l.id}
                    checked={local.labelIds.includes(l.id)}
                    onClick={() => toggle('labelIds', l.id)}
                    dotColor={l.color}
                  >
                    {l.name}
                  </FilterChip>
                ))}
              </div>
            </Section>
          )}

          {/* Phone Numbers */}
          {phoneNumbers.length > 0 && (
            <Section title="Phone Number">
              <div className="flex flex-wrap gap-1.5">
                {phoneNumbers.map((pn) => (
                  <FilterChip
                    key={pn.id}
                    checked={local.phoneNumberIds.includes(pn.id)}
                    onClick={() => toggle('phoneNumberIds', pn.id)}
                  >
                    {pn.label || pn.e164}
                  </FilterChip>
                ))}
              </div>
            </Section>
          )}

          {/* Flags */}
          <Section title="Flags">
            <div className="flex flex-wrap gap-1.5">
              <FilterChip
                checked={local.starred}
                onClick={() => toggleBool('starred')}
                icon={Star}
                activeClass="border-amber-400/40 bg-amber-400/15 text-amber-300"
              >
                Starred
              </FilterChip>
              <FilterChip
                checked={local.pinned}
                onClick={() => toggleBool('pinned')}
                icon={Pin}
                activeClass="border-accent/40 bg-accent-muted text-accent"
              >
                Pinned
              </FilterChip>
              <FilterChip
                checked={local.verified}
                onClick={() => toggleBool('verified')}
                icon={CheckCircle2}
                activeClass="border-emerald-500/40 bg-emerald-500/15 text-emerald-300"
              >
                Verified
              </FilterChip>
            </div>
          </Section>
        </div>
      </div>

      {/* Footer — sticky Done */}
      {activeCount > 0 && (
        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-border-subtle bg-bg-secondary/60 px-4 py-2.5 backdrop-blur">
          <Button
            size="sm"
            className="h-8 px-4 text-[12px]"
            onClick={() => setOpen(false)}
          >
            <Check className="mr-1 h-3.5 w-3.5" /> Done
          </Button>
        </div>
      )}
    </div>
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
            className="h-[85vh] overflow-hidden rounded-t-[16px] p-0 pb-safe"
          >
            <SheetHeader className="sr-only">
              <SheetTitle>Filters</SheetTitle>
            </SheetHeader>
            <div className="h-full">{body}</div>
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
      <PopoverContent align="start" className="w-[340px] overflow-hidden p-0">
        {body}
      </PopoverContent>
    </Popover>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-text-tertiary">
        {title}
      </div>
      {children}
    </div>
  )
}

interface FilterChipProps {
  checked: boolean
  onClick: () => void
  children: React.ReactNode
  dot?: string
  dotColor?: string
  icon?: React.ComponentType<{ className?: string }>
  /** Tailwind classes applied when `checked` — defaults to neutral accent. */
  activeClass?: string
}

function FilterChip({ checked, onClick, children, dot, dotColor, icon: Icon, activeClass }: FilterChipProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-medium transition-all',
        'border',
        checked
          ? activeClass ?? 'border-accent/40 bg-accent-muted text-text-primary'
          : 'border-border-subtle bg-transparent text-text-secondary hover:border-border hover:bg-bg-tertiary/60 hover:text-text-primary',
      )}
    >
      {Icon && (
        <Icon
          className={cn('h-3 w-3', checked && 'fill-current')}
        />
      )}
      {(dot || dotColor) && (
        <span
          className={cn('h-1.5 w-1.5 rounded-full', dot)}
          style={dotColor ? { backgroundColor: dotColor } : undefined}
        />
      )}
      {children}
    </button>
  )
}
