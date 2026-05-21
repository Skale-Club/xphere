'use client'

/**
 * usePaginatedConversations — page-based chat inbox feed (v2.2 + SEED-035).
 *
 * Why page-based instead of infinite scroll: appending every page to the DOM
 * makes the inbox scroll bar shrink to a sliver — it's hard to navigate when
 * the user has hundreds of conversations. True pagination keeps the visible
 * list bounded to `pageSize` items (default 30) plus the small pinned set,
 * and exposes Prev / Next / range indicator controls in a sticky footer.
 *
 * SEED-035 extends the filter surface to: priority (csv), label_ids (csv),
 * starred (boolean), unread (boolean), assigned_user_id (uuid|'unassigned'),
 * bot_status ('active'|'paused'). All are server-side; serialized into the
 * fetch URL and re-fetched on any change.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ConversationSummary } from '@/types/chat'

export interface ConversationFilters {
  status?: string | null
  /** csv of statuses (preferred over single `status`) */
  statuses?: string[] | null
  assigned?: string | null
  channel?: string | null
  /** SEED-035 */
  unread?: boolean | null
  priority?: string[] | null
  botStatus?: string | null
  starred?: boolean | null
  labelIds?: string[] | null
  assignedUserId?: string | null
}

interface FetchPageResponse {
  conversations: ConversationSummary[]
  pinned: ConversationSummary[]
  page: number
  pageSize: number
  totalCount: number
  totalPages: number
}

export interface UsePaginatedConversationsResult {
  /** UNPINNED conversations for the current page (max pageSize). */
  conversations: ConversationSummary[]
  /** Pinned conversations (always full, anchored on top of every page). */
  pinned: ConversationSummary[]
  page: number
  pageSize: number
  totalCount: number
  totalPages: number
  hasNext: boolean
  hasPrev: boolean
  /** True for the very first load (or filter-change re-load). */
  isInitialLoading: boolean
  /** True while changing pages (kept separate so we can keep showing the
   *  previous page during the brief skeleton flash). */
  isPageLoading: boolean
  error: string | null
  goToPage: (n: number) => void
  nextPage: () => void
  prevPage: () => void
  refresh: () => void
  prepend: (c: ConversationSummary) => void
  upsert: (c: ConversationSummary) => void
  remove: (id: string) => void
}

const DEFAULT_PAGE_SIZE = 30

function buildUrl(filters: ConversationFilters, page: number, pageSize: number): string {
  const sp = new URLSearchParams()
  sp.set('page', String(page))
  sp.set('pageSize', String(pageSize))
  if (filters.status) sp.set('status', filters.status)
  if (filters.statuses && filters.statuses.length > 0) {
    sp.set('statuses', filters.statuses.join(','))
  }
  if (filters.assigned) sp.set('assigned', filters.assigned)
  if (filters.channel) sp.set('channel', filters.channel)
  if (filters.unread) sp.set('unread', 'true')
  if (filters.priority && filters.priority.length > 0) {
    sp.set('priority', filters.priority.join(','))
  }
  if (filters.botStatus) sp.set('bot_status', filters.botStatus)
  if (filters.starred) sp.set('starred', 'true')
  if (filters.labelIds && filters.labelIds.length > 0) {
    sp.set('label_ids', filters.labelIds.join(','))
  }
  if (filters.assignedUserId) sp.set('assigned_user_id', filters.assignedUserId)
  return `/api/chat/conversations?${sp.toString()}`
}

/**
 * Sort comparator matching the server: last_message_at desc.
 * Used after prepend/upsert to keep the list coherent on the current page.
 */
function compareConversations(a: ConversationSummary, b: ConversationSummary): number {
  const ta = new Date(a.lastMessageAt ?? a.updatedAt ?? a.createdAt).getTime()
  const tb = new Date(b.lastMessageAt ?? b.updatedAt ?? b.createdAt).getTime()
  return tb - ta
}

export function usePaginatedConversations(
  filters: ConversationFilters = {},
  pageSize: number = DEFAULT_PAGE_SIZE,
): UsePaginatedConversationsResult {
  const [conversations, setConversations] = useState<ConversationSummary[]>([])
  const [pinned, setPinned] = useState<ConversationSummary[]>([])
  const [page, setPage] = useState(1)
  const [totalCount, setTotalCount] = useState(0)
  const [totalPages, setTotalPages] = useState(1)
  const [isInitialLoading, setIsInitialLoading] = useState(true)
  const [isPageLoading, setIsPageLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Serialize filters so we only refetch when they actually change.
  const filterKey = useMemo(
    () =>
      JSON.stringify({
        s: filters.status ?? null,
        ss: filters.statuses ?? null,
        a: filters.assigned ?? null,
        c: filters.channel ?? null,
        u: filters.unread ?? null,
        p: filters.priority ?? null,
        b: filters.botStatus ?? null,
        st: filters.starred ?? null,
        l: filters.labelIds ?? null,
        au: filters.assignedUserId ?? null,
      }),
    [
      filters.status,
      filters.statuses,
      filters.assigned,
      filters.channel,
      filters.unread,
      filters.priority,
      filters.botStatus,
      filters.starred,
      filters.labelIds,
      filters.assignedUserId,
    ],
  )

  // Latest in-flight request, used to ignore stale responses.
  const requestIdRef = useRef(0)
  const filtersRef = useRef(filters)
  const pageRef = useRef(page)

  useEffect(() => {
    filtersRef.current = filters
  }, [filters])
  useEffect(() => {
    pageRef.current = page
  }, [page])

  const fetchPage = useCallback(
    async (targetPage: number, opts: { initial: boolean }) => {
      const id = ++requestIdRef.current
      if (opts.initial) {
        setIsInitialLoading(true)
        setError(null)
      } else {
        setIsPageLoading(true)
      }

      try {
        const res = await fetch(buildUrl(filtersRef.current, targetPage, pageSize), {
          headers: { 'Cache-Control': 'no-cache' },
        })
        if (!res.ok) throw new Error(`Failed (${res.status})`)
        const data: FetchPageResponse = await res.json()
        if (id !== requestIdRef.current) return // stale

        setConversations(data.conversations ?? [])
        setPinned(data.pinned ?? [])
        setTotalCount(data.totalCount ?? 0)
        setTotalPages(Math.max(1, data.totalPages ?? 1))
        // If the server clamped us (e.g. page was beyond range after a
        // delete), reconcile the page state.
        if (typeof data.page === 'number' && data.page !== targetPage) {
          setPage(data.page)
        }
      } catch (err) {
        if (id !== requestIdRef.current) return
        setError(err instanceof Error ? err.message : 'Failed to load')
      } finally {
        if (id === requestIdRef.current) {
          setIsInitialLoading(false)
          setIsPageLoading(false)
        }
      }
    },
    [pageSize],
  )

  // Initial fetch + refetch on filter change (resets to page 1).
  useEffect(() => {
    setPage(1)
    pageRef.current = 1
    fetchPage(1, { initial: true })
  }, [filterKey, fetchPage])

  const goToPage = useCallback(
    (n: number) => {
      const clamped = Math.max(1, Math.min(totalPages, Math.floor(n)))
      if (clamped === pageRef.current) return
      setPage(clamped)
      pageRef.current = clamped
      fetchPage(clamped, { initial: false })
    },
    [fetchPage, totalPages],
  )

  const nextPage = useCallback(() => {
    if (pageRef.current >= totalPages) return
    goToPage(pageRef.current + 1)
  }, [goToPage, totalPages])

  const prevPage = useCallback(() => {
    if (pageRef.current <= 1) return
    goToPage(pageRef.current - 1)
  }, [goToPage])

  const refresh = useCallback(() => {
    fetchPage(pageRef.current, { initial: false })
  }, [fetchPage])

  const prepend = useCallback((c: ConversationSummary) => {
    if (c.pinned) {
      setPinned((prev) => {
        if (prev.some((x) => x.id === c.id)) return prev
        return [c, ...prev].sort(compareConversations)
      })
      return
    }
    // Only mutate the visible page on page 1 — otherwise ordering would drift.
    if (pageRef.current !== 1) return
    setConversations((prev) => {
      if (prev.some((x) => x.id === c.id)) return prev
      const next = [c, ...prev].sort(compareConversations)
      // Keep at most pageSize items; the row that falls off the end will
      // appear on the next page on the next fetch.
      return next.slice(0, pageSize)
    })
    setTotalCount((n) => n + 1)
  }, [pageSize])

  const upsert = useCallback((c: ConversationSummary) => {
    // Try pinned bucket first.
    setPinned((prev) => {
      const idx = prev.findIndex((x) => x.id === c.id)
      if (idx < 0) return prev
      if (!c.pinned) {
        // Got unpinned — drop from pinned bucket; the unpinned bucket
        // refresh below (or the next fetch) will surface it.
        return prev.filter((x) => x.id !== c.id)
      }
      const next = [...prev]
      next[idx] = {
        ...c,
        channelAccountName: c.channelAccountName ?? prev[idx].channelAccountName,
        contactName: c.contactName ?? prev[idx].contactName,
      }
      return next.sort(compareConversations)
    })
    setConversations((prev) => {
      const idx = prev.findIndex((x) => x.id === c.id)
      if (idx < 0) {
        // If it just got pinned, drop it from this bucket (the pinned setter
        // above won't add it because it wasn't there). The next fetch will
        // pull it into the pinned bucket.
        return prev
      }
      if (c.pinned) {
        // It just got pinned — remove from this bucket. The next refresh
        // will surface it in the pinned bucket.
        return prev.filter((x) => x.id !== c.id)
      }
      const next = [...prev]
      next[idx] = {
        ...c,
        channelAccountName: c.channelAccountName ?? prev[idx].channelAccountName,
        contactName: c.contactName ?? prev[idx].contactName,
      }
      return next.sort(compareConversations)
    })
  }, [])

  const remove = useCallback((id: string) => {
    setConversations((prev) => {
      if (!prev.some((c) => c.id === id)) return prev
      setTotalCount((n) => Math.max(0, n - 1))
      return prev.filter((c) => c.id !== id)
    })
    setPinned((prev) => prev.filter((c) => c.id !== id))
  }, [])

  return {
    conversations,
    pinned,
    page,
    pageSize,
    totalCount,
    totalPages,
    hasNext: page < totalPages,
    hasPrev: page > 1,
    isInitialLoading,
    isPageLoading,
    error,
    goToPage,
    nextPage,
    prevPage,
    refresh,
    prepend,
    upsert,
    remove,
  }
}
