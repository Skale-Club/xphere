'use client'

/**
 * Redesigned conversation list (v2.2 / SEED-011 + v2.2 page-based pagination).
 *
 * Visual contract:
 *   - Sticky header: "Inbox" + total count, full-width search with ⌘K hint,
 *     filter pills (All / Unread / Mine + per-channel) using ChannelBadge.
 *   - Pinned section floats to the top on every page when any pinned conv exists.
 *   - Cards: avatar, name, last-message preview (1 line), ChannelBadge inline,
 *     relative timestamp, unread + bot/priority status pills, hover/selected
 *     states, optional 3px accent left-border when priority != normal.
 *   - Skeleton during initial fetch; brief flash on page change.
 *   - Sticky pagination footer at the bottom with Prev / "X–Y of N" / Next.
 *
 * Pagination model:
 *   - True page-based pagination (NOT infinite scroll). 30 conversations
 *     per page max — DOM stays bounded, scroll bar stays usable.
 *   - Filter pill changes propagate up to the parent via `onFilterChange`,
 *     which drives `usePaginatedConversations` to reset to page 1 and refetch.
 *   - Search is client-side only — it filters within the current page.
 *   - Page-change handler scrolls the list viewport back to the top.
 */

import { useState, useEffect, useMemo, useRef, useCallback, memo } from 'react'
import { Search, Pin, Archive, ArchiveRestore, Trash2, ChevronLeft, ChevronRight } from 'lucide-react'
import { formatDistanceToNowStrict } from 'date-fns'

import { ConversationSummary } from '@/types/chat'
import { ChannelBadge, type Channel } from '@/components/design-system/channel-badge'
import { StatusPill } from '@/components/design-system/status-pill'
import { EmptyState } from '@/components/empty-states/empty-state'
import { ListSkeleton } from '@/components/skeletons/list-skeleton'
import { Input } from '@/components/ui/input'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'

// Map raw `channel` strings (DB) → design-system Channel enum
const CHANNEL_MAP: Record<string, Channel> = {
  whatsapp: 'whatsapp',
  instagram: 'instagram',
  messenger: 'messenger',
  sms: 'sms',
  voice: 'voice',
  widget: 'web',
  web: 'web',
}

// Reverse: design-system label → raw DB value for /api filter param
const CHANNEL_TO_DB: Record<Channel, string> = {
  whatsapp: 'whatsapp',
  instagram: 'instagram',
  messenger: 'messenger',
  sms: 'sms',
  voice: 'voice',
  web: 'widget',
  unknown: '',
}

type FilterId = 'all' | 'unread' | 'mine' | Channel

interface FilterPill {
  id: FilterId
  label: string
  channel?: Channel
}

export interface ConversationFilterChange {
  status: string | null
  assigned: string | null
  channel: string | null
}

interface ConversationListProps {
  /** UNPINNED conversations for the current page (max pageSize). */
  conversations: ConversationSummary[]
  /** Pinned conversations (always anchored on top of every page). */
  pinned: ConversationSummary[]
  selectedId: string | null
  currentUserId: string | null
  /** True during the very first load or a filter-change re-load. */
  isLoading: boolean
  /** True while changing pages — keeps the previous page visible briefly. */
  isPageLoading: boolean
  loadError: string | null

  /** v2.2 pagination */
  page: number
  pageSize: number
  totalCount: number
  totalPages: number
  hasNext: boolean
  hasPrev: boolean
  onNextPage: () => void
  onPrevPage: () => void

  onRetry: () => void
  onFilterChange: (filters: ConversationFilterChange) => void
  onSelect: (id: string) => void
  onConversationUpdated: () => void
  onConversationDeleted: (id: string) => void
  /** Optimistic pin/unpin handled by parent; updates apply on realtime echo. */
  onPin?: (id: string, pinned: boolean) => void
}

function formatRelative(c: ConversationSummary): string {
  const dateStr = c.lastMessageAt ?? c.updatedAt ?? c.createdAt
  try {
    return formatDistanceToNowStrict(new Date(dateStr), { addSuffix: false })
      .replace(' seconds', 's')
      .replace(' second', 's')
      .replace(' minutes', 'min')
      .replace(' minute', 'min')
      .replace(' hours', 'h')
      .replace(' hour', 'h')
      .replace(' days', 'd')
      .replace(' day', 'd')
      .replace(' months', 'mo')
      .replace(' month', 'mo')
      .replace(' years', 'y')
      .replace(' year', 'y')
  } catch {
    return ''
  }
}

function displayNameOf(c: ConversationSummary): string {
  return c.visitorName ?? c.visitorPhone ?? c.visitorEmail ?? 'Anonymous'
}

function initialOf(name: string): string {
  return name.replace(/[^a-zA-Z0-9]/g, '').charAt(0).toUpperCase() || '?'
}

// All channels are always available as pills — we don't auto-derive from
// loaded data anymore because pagination only gives us a window.
const ALL_CHANNEL_PILLS: Channel[] = ['whatsapp', 'instagram', 'messenger', 'sms', 'voice', 'web']

export function ConversationList({
  conversations,
  pinned,
  selectedId,
  currentUserId,
  isLoading,
  isPageLoading,
  loadError,
  page,
  pageSize,
  totalCount,
  totalPages,
  hasNext,
  hasPrev,
  onNextPage,
  onPrevPage,
  onRetry,
  onFilterChange,
  onSelect,
  onConversationUpdated,
  onConversationDeleted,
  onPin,
}: ConversationListProps) {
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [activeFilter, setActiveFilter] = useState<FilterId>('all')
  const searchRef = useRef<HTMLInputElement>(null)
  const scrollViewportRef = useRef<HTMLDivElement | null>(null)

  // Debounce search (300ms) — search is client-side over the current page.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300)
    return () => clearTimeout(t)
  }, [search])

  // ⌘K / Ctrl+K focuses search
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        searchRef.current?.focus()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  // Propagate filter changes to parent (which drives server fetch + page reset).
  useEffect(() => {
    let status: string | null = null
    let assigned: string | null = null
    let channel: string | null = null
    if (activeFilter === 'unread') status = 'open'
    else if (activeFilter === 'mine') assigned = 'me'
    else if (activeFilter !== 'all') {
      const dbValue = CHANNEL_TO_DB[activeFilter as Channel]
      if (dbValue) channel = dbValue
    }
    onFilterChange({ status, assigned, channel })
  }, [activeFilter, onFilterChange])

  // Scroll to top whenever the page changes (so the user always lands at the
  // top of the new page instead of mid-scroll).
  useEffect(() => {
    const viewport = scrollViewportRef.current
    if (viewport) viewport.scrollTo({ top: 0, behavior: 'auto' })
  }, [page])

  const statusPills: FilterPill[] = useMemo(() => {
    const base: FilterPill[] = [
      { id: 'all', label: 'All' },
      { id: 'unread', label: 'Unread' },
    ]
    if (currentUserId) base.push({ id: 'mine', label: 'Mine' })
    return base
  }, [currentUserId])

  const channelPills: FilterPill[] = useMemo(() => {
    return ALL_CHANNEL_PILLS.map((ch) => ({
      id: ch,
      label: ch.charAt(0).toUpperCase() + ch.slice(1),
      channel: ch,
    }))
  }, [])

  // Search is local-only — filters the current page.
  const filteredUnpinned = useMemo(() => {
    if (!debouncedSearch.trim()) return conversations
    const q = debouncedSearch.toLowerCase()
    return conversations.filter((c) => {
      const hay = [c.visitorName, c.visitorEmail, c.visitorPhone, c.lastMessage]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      return hay.includes(q)
    })
  }, [conversations, debouncedSearch])

  const filteredPinned = useMemo(() => {
    if (!debouncedSearch.trim()) return pinned
    const q = debouncedSearch.toLowerCase()
    return pinned.filter((c) => {
      const hay = [c.visitorName, c.visitorEmail, c.visitorPhone, c.lastMessage]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      return hay.includes(q)
    })
  }, [pinned, debouncedSearch])

  const hasAnyOnPage = filteredUnpinned.length + filteredPinned.length > 0

  // Range string: "1–30 of 171"
  const rangeStart = totalCount === 0 ? 0 : (page - 1) * pageSize + 1
  const rangeEnd = Math.min(page * pageSize, totalCount)

  return (
    <div className="flex h-full min-w-0 flex-col overflow-hidden border-r border-border-subtle bg-bg-secondary/40">
      {/* Sticky header */}
      <div className="sticky top-0 z-10 border-b border-border-subtle bg-bg-secondary/95 backdrop-blur px-4 pt-4 pb-3">
        <div className="mb-3 flex min-w-0 items-baseline justify-between gap-3">
          <h2 className="min-w-0 truncate text-[15px] font-semibold tracking-tight text-text-primary">
            Inbox
          </h2>
          {totalCount > 0 && (
            <span className="shrink-0 text-[11px] tabular-nums text-text-tertiary">
              {totalCount} total
            </span>
          )}
        </div>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-text-tertiary" />
          <Input
            ref={searchRef}
            placeholder="Search this page…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-9 pl-9 pr-12 text-[13px] rounded-[8px] bg-bg-primary border-border-subtle focus-visible:border-accent focus-visible:ring-[3px] focus-visible:ring-accent/15"
          />
          <kbd className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-[5px] border border-border-subtle bg-bg-tertiary px-1.5 py-0.5 text-[10px] font-mono text-text-tertiary">
            ⌘K
          </kbd>
        </div>

        {/* Status filter row */}
        <div className="mt-3 flex gap-1.5">
          {statusPills.map((pill) => {
            const active = activeFilter === pill.id
            return (
              <button
                key={pill.id}
                type="button"
                onClick={() => setActiveFilter(pill.id)}
                className={cn(
                  'inline-flex items-center shrink-0 rounded-[6px] px-2.5 py-1 text-[11.5px] font-medium tracking-tight transition-all duration-150',
                  active
                    ? 'bg-accent-muted text-accent ring-1 ring-accent/20'
                    : 'bg-bg-tertiary/50 text-text-secondary hover:bg-bg-tertiary hover:text-text-primary',
                )}
              >
                {pill.label}
              </button>
            )
          })}
        </div>

        {/* Channel filter row — icon-only, fits all channels on one row */}
        <div className="mt-2 flex items-center gap-1">
          <span className="text-[10px] uppercase tracking-wider text-text-tertiary mr-1.5">
            Channel
          </span>
          {channelPills.map((pill) => {
            const active = activeFilter === pill.id
            return (
              <TooltipProvider key={pill.id} delayDuration={200}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={() => setActiveFilter(active ? 'all' : pill.id)}
                      aria-label={`Filter by ${pill.label}`}
                      className={cn(
                        'inline-flex items-center justify-center h-7 w-7 shrink-0 rounded-[6px] transition-all duration-150',
                        active
                          ? 'bg-accent-muted ring-1 ring-accent/30'
                          : 'bg-bg-tertiary/50 hover:bg-bg-tertiary',
                      )}
                    >
                      {pill.channel && (
                        <ChannelBadge channel={pill.channel} showLabel={false} size="sm" className="ring-0" />
                      )}
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" sideOffset={4}>
                    {pill.label}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )
          })}
        </div>
      </div>

      {/* List — min-h-0 lets the flex child shrink below content size so
          the internal ScrollArea actually scrolls instead of overflowing. */}
      <ScrollArea className="min-h-0 flex-1" viewportRef={scrollViewportRef}>
        <div className="p-2 space-y-1">
          {isLoading ? (
            <div className="p-3">
              <ListSkeleton rows={8} />
            </div>
          ) : loadError && !hasAnyOnPage ? (
            <div className="p-4">
              <EmptyState
                icon={Search}
                title="Could not load conversations"
                description={loadError}
              />
              <div className="mt-3 flex justify-center">
                <button
                  type="button"
                  onClick={onRetry}
                  className="rounded-[6px] border border-border-subtle bg-bg-tertiary px-3 py-1.5 text-[12px] font-medium text-text-primary hover:bg-bg-tertiary/80"
                >
                  Retry
                </button>
              </div>
            </div>
          ) : !hasAnyOnPage ? (
            <div className="p-4">
              <EmptyState
                icon={Search}
                title={
                  totalCount === 0 && pinned.length === 0
                    ? 'No conversations yet'
                    : 'No matches'
                }
                description={
                  totalCount === 0 && pinned.length === 0
                    ? 'When customers message you across WhatsApp, Instagram, SMS, or your web widget, conversations will land here.'
                    : 'Try a different search term, filter, or page.'
                }
              />
            </div>
          ) : (
            <div className={cn(isPageLoading && 'opacity-60 transition-opacity')}>
              {filteredPinned.length > 0 && (
                <>
                  <SectionLabel>Pinned</SectionLabel>
                  {filteredPinned.map((c) => (
                    <MemoConversationCard
                      key={c.id}
                      conversation={c}
                      selected={c.id === selectedId}
                      onSelect={onSelect}
                      onPin={onPin}
                      onArchive={onConversationUpdated}
                      onDelete={onConversationDeleted}
                    />
                  ))}
                  {filteredUnpinned.length > 0 && <SectionLabel>All</SectionLabel>}
                </>
              )}
              {filteredUnpinned.map((c) => (
                <MemoConversationCard
                  key={c.id}
                  conversation={c}
                  selected={c.id === selectedId}
                  onSelect={onSelect}
                  onPin={onPin}
                  onArchive={onConversationUpdated}
                  onDelete={onConversationDeleted}
                />
              ))}
            </div>
          )}
        </div>
      </ScrollArea>

      {/* Sticky pagination footer */}
      {totalCount > 0 && (
        <div className="sticky bottom-0 z-10 flex items-center justify-between gap-2 border-t border-border-subtle bg-bg-secondary/95 backdrop-blur px-3 py-2">
          <button
            type="button"
            onClick={onPrevPage}
            disabled={!hasPrev || isPageLoading}
            aria-label="Previous page"
            title="Previous page"
            className={cn(
              'flex h-7 w-7 items-center justify-center rounded-[6px] text-text-tertiary transition-colors',
              'hover:bg-bg-tertiary hover:text-text-primary',
              'disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-text-tertiary',
            )}
          >
            <ChevronLeft className="h-4 w-4" />
          </button>

          <div className="flex flex-col items-center text-center leading-tight">
            <span className="text-[11px] tabular-nums text-text-secondary">
              {rangeStart}–{rangeEnd} of {totalCount}
            </span>
            <span className="text-[10px] tabular-nums text-text-tertiary">
              Page {page} of {totalPages}
            </span>
          </div>

          <button
            type="button"
            onClick={onNextPage}
            disabled={!hasNext || isPageLoading}
            aria-label="Next page"
            title="Next page"
            className={cn(
              'flex h-7 w-7 items-center justify-center rounded-[6px] text-text-tertiary transition-colors',
              'hover:bg-bg-tertiary hover:text-text-primary',
              'disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-text-tertiary',
            )}
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      )}
    </div>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-3 pt-3 pb-1 text-[10.5px] font-medium uppercase tracking-[0.08em] text-text-tertiary">
      {children}
    </div>
  )
}

interface ConversationCardProps {
  conversation: ConversationSummary
  selected: boolean
  onSelect: (id: string) => void
  onPin?: (id: string, pinned: boolean) => void
  onArchive: () => void
  onDelete: (id: string) => void
}

function ConversationCardBase({
  conversation,
  selected,
  onSelect,
  onPin,
  onArchive,
  onDelete,
}: ConversationCardProps) {
  const [showDelete, setShowDelete] = useState(false)
  const name = displayNameOf(conversation)
  const initial = initialOf(name)
  const channel = (CHANNEL_MAP[conversation.channel] ?? 'unknown') as Channel
  const isBotPaused = conversation.botStatus === 'paused'
  const isArchived = conversation.status === 'closed'
  const priority = conversation.priority ?? 'normal'

  const priorityBar =
    priority === 'urgent'
      ? 'before:bg-danger'
      : priority === 'high'
        ? 'before:bg-warning'
        : selected
          ? 'before:bg-accent'
          : 'before:bg-transparent'

  const handleArchiveClick = useCallback(
    async (e: React.MouseEvent) => {
      e.stopPropagation()
      await fetch(`/api/chat/conversations/${conversation.id}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: isArchived ? 'open' : 'closed' }),
      })
      onArchive()
    },
    [conversation.id, isArchived, onArchive],
  )

  const handleDeleteConfirm = useCallback(
    async (e: React.MouseEvent) => {
      e.stopPropagation()
      await fetch(`/api/chat/conversations/${conversation.id}`, { method: 'DELETE' })
      onDelete(conversation.id)
    },
    [conversation.id, onDelete],
  )

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onSelect(conversation.id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onSelect(conversation.id)
        }
      }}
      className={cn(
        'group relative flex w-full min-w-0 cursor-pointer items-start gap-3 overflow-hidden rounded-[8px] px-3 py-2.5 transition-all duration-150 outline-none',
        'before:absolute before:left-0 before:top-2 before:bottom-2 before:w-[3px] before:rounded-r-full before:transition-colors',
        priorityBar,
        selected
          ? 'bg-accent-muted/60'
          : 'hover:bg-bg-tertiary/50 focus-visible:bg-bg-tertiary/60 focus-visible:ring-2 focus-visible:ring-accent/20',
      )}
    >
      <Avatar className="h-9 w-9 shrink-0 mt-0.5">
        <AvatarFallback
          className={cn(
            'text-[12.5px] font-semibold',
            selected
              ? 'bg-accent text-white'
              : 'bg-bg-tertiary text-text-secondary',
          )}
        >
          {initial}
        </AvatarFallback>
      </Avatar>

      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex min-w-0 items-center justify-between gap-2">
          <div className="flex min-w-0 flex-1 items-center gap-1.5">
            {conversation.pinned && (
              <Pin className="h-3 w-3 shrink-0 text-text-tertiary" fill="currentColor" />
            )}
            <span
              className={cn(
                'min-w-0 truncate text-[13px] font-semibold tracking-tight',
                selected ? 'text-text-primary' : 'text-text-primary',
              )}
            >
              {name}
            </span>
          </div>
          <span className="shrink-0 whitespace-nowrap text-right text-[10.5px] tabular-nums text-text-tertiary">
            {formatRelative(conversation)}
          </span>
        </div>

        <div className="flex min-w-0 items-center justify-between gap-2">
          <p
            className={cn(
              'min-w-0 flex-1 truncate text-[12px] leading-snug',
              selected ? 'text-text-secondary' : 'text-text-tertiary',
            )}
          >
            {conversation.lastMessage || (
              <span className="italic text-text-tertiary/70">No messages yet</span>
            )}
          </p>
          <div className="flex shrink-0 items-center gap-1">
            {channel !== 'unknown' && <ChannelBadge channel={channel} showLabel={false} />}
          </div>
        </div>

        {(isBotPaused || isArchived || conversation.assignedUserId) && (
          <div className="mt-1 flex flex-wrap items-center gap-1">
            {isBotPaused && (
              <StatusPill tone="warning" className="!py-0 !text-[10px]">
                Bot paused
              </StatusPill>
            )}
            {isArchived && (
              <StatusPill tone="idle" className="!py-0 !text-[10px]">
                Archived
              </StatusPill>
            )}
            {conversation.assignedUserId && (
              <StatusPill tone="info" className="!py-0 !text-[10px]">
                Assigned
              </StatusPill>
            )}
          </div>
        )}
      </div>

      {/* Hover-only quick actions (right side) */}
      <div
        className="absolute right-2 top-2 hidden gap-0.5 rounded-[6px] bg-bg-elevated/95 p-0.5 ring-1 ring-border-subtle shadow-sm group-hover:flex"
        onClick={(e) => e.stopPropagation()}
      >
        {onPin && (
          <button
            type="button"
            title={conversation.pinned ? 'Unpin' : 'Pin'}
            onClick={(e) => {
              e.stopPropagation()
              onPin(conversation.id, !conversation.pinned)
            }}
            className="flex h-6 w-6 items-center justify-center rounded-[5px] text-text-tertiary hover:bg-bg-tertiary hover:text-text-primary"
          >
            <Pin className="h-3 w-3" fill={conversation.pinned ? 'currentColor' : 'none'} />
          </button>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              title="More"
              onClick={(e) => e.stopPropagation()}
              className="flex h-6 w-6 items-center justify-center rounded-[5px] text-text-tertiary hover:bg-bg-tertiary hover:text-text-primary"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                <circle cx="5" cy="12" r="2" />
                <circle cx="12" cy="12" r="2" />
                <circle cx="19" cy="12" r="2" />
              </svg>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
            <DropdownMenuItem onClick={handleArchiveClick}>
              {isArchived ? (
                <>
                  <ArchiveRestore className="h-3.5 w-3.5 mr-2" />
                  Reopen
                </>
              ) : (
                <>
                  <Archive className="h-3.5 w-3.5 mr-2" />
                  Archive
                </>
              )}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={(e) => {
                e.stopPropagation()
                setShowDelete(true)
              }}
              className="text-rose-500 focus:text-rose-500"
            >
              <Trash2 className="h-3.5 w-3.5 mr-2" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <AlertDialog open={showDelete} onOpenChange={setShowDelete}>
        <AlertDialogContent onClick={(e) => e.stopPropagation()}>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete conversation?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the conversation with <strong>{name}</strong> and all
              its messages. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={(e) => e.stopPropagation()}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteConfirm}
              className="bg-danger text-white hover:bg-danger/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

/**
 * Memoize cards on the fields that visibly change. With dozens of rendered
 * cards this prevents re-renders cascading on every parent state change.
 */
const MemoConversationCard = memo(ConversationCardBase, (prev, next) => {
  if (prev.selected !== next.selected) return false
  if (prev.onPin !== next.onPin) return false
  const a = prev.conversation
  const b = next.conversation
  return (
    a.id === b.id &&
    a.lastMessageAt === b.lastMessageAt &&
    a.lastMessage === b.lastMessage &&
    a.pinned === b.pinned &&
    a.priority === b.priority &&
    a.status === b.status &&
    a.botStatus === b.botStatus &&
    a.assignedUserId === b.assignedUserId &&
    a.visitorName === b.visitorName
  )
})
