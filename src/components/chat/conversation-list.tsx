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
 *     per page max | DOM stays bounded, scroll bar stays usable.
 *   - Filter pill changes propagate up to the parent via `onFilterChange`,
 *     which drives `usePaginatedConversations` to reset to page 1 and refetch.
 *   - Search is client-side only | it filters within the current page.
 *   - Page-change handler scrolls the list viewport back to the top.
 */

import { useState, useEffect, useMemo, useRef, useCallback, memo } from 'react'
import { Search, Pin, Archive, ArchiveRestore, Trash2, ChevronLeft, ChevronRight, Bot, User, Star } from 'lucide-react'
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
import { FilterPanel, type AdvancedFilters, EMPTY_FILTERS, countActiveFilters } from './filter-panel'
import type { OrgMember } from '@/app/(dashboard)/chat/actions'
import { ContactDetailSheet } from '@/components/contacts/contact-detail-sheet'

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
  email: 'email',
  web: 'widget',
  unknown: '',
}

type FilterId = 'all' | 'unread' | 'mine' | Channel
type StatusId = 'all' | 'unread' | 'mine'

interface FilterPill {
  id: FilterId
  label: string
  channel?: Channel
}

export interface ConversationFilterChange {
  status: string | null
  assigned: string | null
  channel: string | null
  /** SEED-035: advanced filter params */
  starred?: boolean | null
  labelIds?: string[]
  priority?: string | null
  botStatus?: string | null
  unread?: boolean | null
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
  /** True while changing pages | keeps the previous page visible briefly. */
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
  onStar?: (id: string, starred: boolean) => void
  /** SEED-035: org labels for advanced filter panel */
  orgLabels?: Array<{ id: string; name: string; color: string }>
  /** SEED-035: org members for advanced filter panel */
  members?: OrgMember[]
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
  return c.contactName || c.visitorName || c.visitorPhone || c.visitorEmail || 'Anonymous'
}

function initialOf(name: string): string {
  return name.replace(/[^a-zA-Z0-9]/g, '').charAt(0).toUpperCase() || '?'
}

// All channels are always available as pills | we don't auto-derive from
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
  orgLabels = [],
  members = [],
}: ConversationListProps) {
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusId>('all')
  const [selectedChannels, setSelectedChannels] = useState<Set<Channel>>(new Set())
  const [advancedFilters, setAdvancedFilters] = useState<AdvancedFilters>(EMPTY_FILTERS)
  const searchRef = useRef<HTMLInputElement>(null)
  const scrollViewportRef = useRef<HTMLDivElement | null>(null)

  // Debounce search (300ms) | search is client-side over the current page.
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

    // Status pill (single-select)
    if (statusFilter === 'unread') status = 'open'
    else if (statusFilter === 'mine') assigned = 'me'

    // Channel pills (multi-select) | comma-separated for the API
    if (selectedChannels.size > 0) {
      const dbValues = Array.from(selectedChannels)
        .map((ch) => CHANNEL_TO_DB[ch])
        .filter(Boolean)
      if (dbValues.length > 0) channel = dbValues.join(',')
    }

    // Advanced filter overrides pill status when active
    if (advancedFilters.statuses.length === 1) status = advancedFilters.statuses[0]
    else if (advancedFilters.statuses.length > 1) status = advancedFilters.statuses[0] // first wins for now
    if (advancedFilters.unread) status = 'open'

    onFilterChange({
      status,
      assigned,
      channel,
      starred: advancedFilters.starred || null,
      labelIds: advancedFilters.labelIds.length ? advancedFilters.labelIds : undefined,
      priority: advancedFilters.priorities[0] ?? null,
      botStatus: advancedFilters.botStatuses[0] ?? null,
      unread: advancedFilters.unread || null,
    })
  }, [statusFilter, selectedChannels, advancedFilters, onFilterChange])

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

  // Search is local-only | filters the current page.
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
        <div className="mb-3 flex min-w-0 items-center justify-between gap-3">
          <h2 className="min-w-0 truncate text-[15px] font-semibold tracking-tight text-text-primary">
            Inbox
          </h2>
          <div className="flex items-center gap-2 shrink-0">
            {totalCount > 0 && (
              <span className="text-[11px] tabular-nums text-text-tertiary">
                {totalCount} total
              </span>
            )}
<FilterPanel
                value={advancedFilters}
                onChange={setAdvancedFilters}
                viewFilter={statusFilter}
                onViewFilterChange={setStatusFilter}
                selectedChannels={selectedChannels}
                onSelectedChannelsChange={setSelectedChannels}
                members={members}
                labels={orgLabels}
                allowMine={false}
            />
          </div>
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
          <kbd className="absolute right-2.5 top-1/2 -translate-y-1/2 hidden md:inline-block rounded-[5px] border border-border-subtle bg-bg-tertiary px-1.5 py-0.5 text-[10px] font-mono text-text-tertiary">
            ⌘K
          </kbd>
        </div>
      </div>

      {/* List | min-h-0 lets the flex child shrink below content size so
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
  const [contactSheetId, setContactSheetId] = useState<string | null>(null)
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
        'group relative flex w-full min-w-0 cursor-pointer items-center gap-3 overflow-hidden rounded-[8px] px-3 py-2.5 transition-all duration-150 outline-none',
        'before:absolute before:left-0 before:top-2 before:bottom-2 before:w-[3px] before:rounded-r-full before:transition-colors',
        priorityBar,
        selected
          ? 'bg-accent-muted/60'
          : 'hover:bg-bg-tertiary/50 focus-visible:bg-bg-tertiary/60 focus-visible:ring-2 focus-visible:ring-accent/20',
      )}
    >
      <Avatar className="h-9 w-9 shrink-0">
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

      {/* Main content */}
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex min-w-0 items-center gap-1.5">
          {conversation.pinned && (
            <Pin className="h-3 w-3 shrink-0 text-text-tertiary" fill="currentColor" />
          )}
          <span className="min-w-0 truncate text-[13px] font-semibold tracking-tight text-text-primary">
            {name}
          </span>
          {conversation.starred && (
            <TooltipProvider delayDuration={200}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Star className="h-3 w-3 shrink-0 text-amber-400" fill="currentColor" aria-label="Starred" />
                </TooltipTrigger>
                <TooltipContent side="bottom">Starred</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
          {conversation.contactId && (
            <TooltipProvider delayDuration={200}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      setContactSheetId(conversation.contactId ?? null)
                    }}
                    className="inline-flex shrink-0 cursor-pointer"
                    aria-label="Contact linked"
                  >
                    <User className="h-3 w-3 shrink-0 text-accent" fill="currentColor" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom">Contact linked — click to edit</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
          {isBotPaused && (
            <TooltipProvider delayDuration={200}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span
                    className="relative inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center text-warning cursor-default"
                    aria-label="Bot paused"
                  >
                    <svg viewBox="0 0 100 100" className="h-2.5 w-2.5" fill="white" aria-hidden>
                      <g><path d="M70.18,43.98H29.82c-3.3,0-6,2.71-6,6v23.94c0,3.3,2.7,6,6,6h40.36c3.301,0,6-2.7,6-6V49.98C76.18,46.69,73.48,43.98,70.18,43.98z M36.44,66.99c-2.78,0-5.04-2.25-5.04-5.04c0-2.78,2.26-5.03,5.04-5.03c2.78,0,5.04,2.25,5.04,5.03C41.48,64.74,39.22,66.99,36.44,66.99z M63.56,66.99c-2.779,0-5.029-2.25-5.029-5.04c0-2.78,2.25-5.03,5.029-5.03c2.78,0,5.04,2.25,5.04,5.03C68.6,64.74,66.34,66.99,63.56,66.99z"/></g>
                      <path d="M55.49,22.733c0,2.06-1.13,3.85-2.811,4.79v13.63H47.32v-13.63c-1.681-0.94-2.811-2.73-2.811-4.79c0-3.03,2.46-5.49,5.49-5.49S55.49,19.703,55.49,22.733z"/>
                      <g><path d="M20.82,51.145v21.62h-5.54c-3.3,0-6-2.699-6-6v-9.62c0-3.299,2.7-6,6-6H20.82z"/></g>
                      <g><path d="M90.72,57.145v9.62c0,3.301-2.7,6-6,6h-5.54v-21.62h5.54C88.02,51.145,90.72,53.846,90.72,57.145z"/></g>
                    </svg>
                    <svg
                      className="absolute inset-0 h-full w-full text-warning"
                      viewBox="0 0 16 16"
                      fill="none"
                      aria-hidden
                    >
                      <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.8" />
                      <line x1="3" y1="3" x2="13" y2="13" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                    </svg>
                  </span>
                </TooltipTrigger>
                <TooltipContent side="bottom">Bot paused</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
        </div>

        <p className={cn(
          'min-w-0 truncate text-[12px] leading-snug',
          selected ? 'text-text-secondary' : 'text-text-tertiary',
        )}>
          {conversation.lastMessage || (
            <span className="italic text-text-tertiary/70">No messages yet</span>
          )}
        </p>

        {(isArchived || conversation.assignedUserId) && (
          <div className="mt-0.5 flex flex-wrap items-center gap-1">
            {isArchived && (
              <StatusPill tone="idle" className="!py-0 !text-[10px]">Archived</StatusPill>
            )}
            {conversation.contactId && (
              <StatusPill tone="info" className="!py-0 !text-[10px]">Contact linked</StatusPill>
            )}
          </div>
        )}
      </div>

      {/* Right column: timestamp + channel badge stacked + vertically centered */}
      <div className="flex shrink-0 flex-col items-end gap-1.5 self-center">
        <span className="whitespace-nowrap text-[10.5px] tabular-nums text-text-tertiary">
          {formatRelative(conversation)}
        </span>
        {channel !== 'unknown' && (
          <TooltipProvider delayDuration={200}>
            <Tooltip>
              <TooltipTrigger asChild>
                <span>
                  <ChannelBadge channel={channel} showLabel={false} />
                </span>
              </TooltipTrigger>
              <TooltipContent side="left">
                <div className="flex flex-col gap-0.5">
                  <span>
                    {{
                      whatsapp: 'WhatsApp',
                      instagram: 'Instagram',
                      messenger: 'Messenger',
                      sms: 'SMS',
                      voice: 'Voice',
                      email: 'Email',
                      web: 'Web',
                      unknown: 'Unknown',
                    }[channel] ?? channel}
                  </span>
                  {conversation.phoneNumberLabel && (
                    <span className="text-[10.5px] text-text-tertiary">
                      via {conversation.phoneNumberLabel}
                    </span>
                  )}
                </div>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
      </div>

      <ContactDetailSheet
        contactId={contactSheetId}
        onOpenChange={(open) => {
          if (!open) setContactSheetId(null)
        }}
      />

      {/* Hover-only quick actions (right side) */}

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
    a.starred === b.starred &&
    a.assignedUserId === b.assignedUserId &&
    a.visitorName === b.visitorName
  )
})
