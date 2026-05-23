// GET /api/chat/conversations
// Returns a paginated page of conversations for the active org, ordered by
// last activity. Pinned rows are returned separately and always rendered on top
// of every page by the UI. Auth-gated: returns 401 if no user session.
//
// Query params:
//   page      | 1-indexed page number (default 1)
//   pageSize  | items per page (default 30, max 100)
//   status    | 'open' | 'closed' (optional filter)
//   assigned  | 'me' (filter to conversations assigned to the current user)
//   channel   | 'whatsapp' | 'instagram' | 'messenger' | 'sms' | 'voice' | 'widget' | 'web'
//   starred   | '1' (only starred conversations)
//
// Response shape:
//   {
//     conversations:  ConversationSummary[]   // page of UNPINNED rows
//     pinned:         ConversationSummary[]   // ALL pinned rows (small set)
//     page:           number
//     pageSize:       number
//     totalCount:     number                   // unpinned count under current filters
//     totalPages:     number
//   }
//
// Pagination semantics:
//   - Pagination is over UNPINNED conversations. Pinned rows are always
//     returned in full (tiny set, typically <5) and the UI anchors them on top.
//   - totalCount / totalPages reflect the unpinned set under the current
//     filters so the "Showing 1–30 of N" range matches what the user sees.

import { createClient, getUser } from '@/lib/supabase/server'
import type { ConversationSummary, ConversationPriority, ConversationStatus } from '@/types/chat'

export const runtime = 'nodejs'

const DEFAULT_PAGE_SIZE = 30
const MAX_PAGE_SIZE = 100

// Channel filter accepts either the raw DB value ('widget') or the design-
// system label ('web'). We normalize 'web' → 'widget' at query time.
const CHANNEL_ALIAS: Record<string, string> = {
  web: 'widget',
}

const SELECT_COLS =
  'id, status, created_at, updated_at, last_message_at, visitor_name, visitor_email, visitor_phone, last_message, channel, channel_metadata, bot_status, pinned, priority, contact_id, assigned_user_id, starred, wait_until, contacts:contact_id ( first_name, last_name, name )'

const VALID_STATUSES = new Set<ConversationStatus>([
  'open',
  'pending',
  'waiting',
  'resolved',
  'closed',
])
const VALID_PRIORITIES = new Set(['normal', 'high', 'urgent'])
const VALID_BOT_STATUSES = new Set(['active', 'paused'])

function clampInt(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback
  return Math.max(min, Math.min(max, Math.floor(value)))
}

export async function GET(request: Request): Promise<Response> {
  const user = await getUser()
  if (!user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const url = new URL(request.url)
  const page = clampInt(Number(url.searchParams.get('page') ?? 1), 1, 100_000, 1)
  const pageSize = clampInt(
    Number(url.searchParams.get('pageSize') ?? DEFAULT_PAGE_SIZE),
    1,
    MAX_PAGE_SIZE,
    DEFAULT_PAGE_SIZE,
  )
  const status = url.searchParams.get('status')
  const assigned = url.searchParams.get('assigned')
  const channelParam = url.searchParams.get('channel')
  const starred = url.searchParams.get('starred') === '1'
  const priority = url.searchParams.get('priority')
  const botStatus = url.searchParams.get('botStatus')
  // Supports comma-separated values for multi-channel filtering (additive).
  const channels = channelParam
    ? channelParam.split(',').map((c) => CHANNEL_ALIAS[c] ?? c).filter(Boolean)
    : []

  const supabase = await createClient()

  // ─────────── Pinned (always full, no pagination) ───────────
  let pinnedQuery = supabase
    .from('conversations')
    .select(SELECT_COLS)
    .eq('pinned', true)
    .order('last_message_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })

  if (status) pinnedQuery = pinnedQuery.eq('status', status)
  if (assigned === 'me') pinnedQuery = pinnedQuery.eq('assigned_user_id', user.id)
  if (channels.length === 1) pinnedQuery = pinnedQuery.eq('channel', channels[0])
  else if (channels.length > 1) pinnedQuery = pinnedQuery.in('channel', channels)
  if (starred) pinnedQuery = pinnedQuery.eq('starred', true)
  if (priority && VALID_PRIORITIES.has(priority)) pinnedQuery = pinnedQuery.eq('priority', priority)
  if (botStatus && VALID_BOT_STATUSES.has(botStatus)) pinnedQuery = pinnedQuery.eq('bot_status', botStatus)

  const { data: pinnedData, error: pinnedErr } = await pinnedQuery
  if (pinnedErr) {
    console.error('[GET /api/chat/conversations] pinned', pinnedErr)
    return Response.json({ error: 'Failed to load conversations', detail: pinnedErr.message }, { status: 500 })
  }
  const pinnedRows = (pinnedData ?? []) as Record<string, unknown>[]

  // ─────────── Unpinned page (range + exact count) ───────────
  const from = (page - 1) * pageSize
  const to = from + pageSize - 1

  let pageQuery = supabase
    .from('conversations')
    .select(SELECT_COLS, { count: 'exact' })
    .eq('pinned', false)
    .order('last_message_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
    .range(from, to)

  if (status) pageQuery = pageQuery.eq('status', status)
  if (assigned === 'me') pageQuery = pageQuery.eq('assigned_user_id', user.id)
  if (channels.length === 1) pageQuery = pageQuery.eq('channel', channels[0])
  else if (channels.length > 1) pageQuery = pageQuery.in('channel', channels)
  if (starred) pageQuery = pageQuery.eq('starred', true)
  if (priority && VALID_PRIORITIES.has(priority)) pageQuery = pageQuery.eq('priority', priority)
  if (botStatus && VALID_BOT_STATUSES.has(botStatus)) pageQuery = pageQuery.eq('bot_status', botStatus)

  const { data: pageData, error: pageErr, count } = await pageQuery
  if (pageErr) {
    console.error('[GET /api/chat/conversations] page', pageErr)
    return Response.json({ error: 'Failed to load conversations' }, { status: 500 })
  }

  const pageRows = (pageData ?? []) as Record<string, unknown>[]
  const totalCount = count ?? 0
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize))

  // ─────────── Secondary: resolve page_name for Meta conversations ───────────
  const allRows = [...pinnedRows, ...pageRows]
  const pageIds = [
    ...new Set(
      allRows
        .filter((r) => r.channel !== 'widget')
        .map((r) => (r.channel_metadata as Record<string, string>)?.page_id)
        .filter(Boolean) as string[]
    ),
  ]

  const pageNameMap: Record<string, string> = {}
  if (pageIds.length > 0) {
    const { data: channels } = await supabase
      .from('meta_channels')
      .select('page_id, page_name')
      .in('page_id', pageIds)
    for (const ch of channels ?? []) {
      pageNameMap[ch.page_id] = ch.page_name ?? ch.page_id
    }
  }

  function rowToSummary(row: Record<string, unknown>): ConversationSummary {
    const meta = (row.channel_metadata as Record<string, string>) ?? {}
    const pageId = meta?.page_id
    const id = row.id as string
    const contact = row.contacts as { first_name?: string | null; last_name?: string | null; name?: string | null } | null
    const contactName =
      [contact?.first_name?.trim(), contact?.last_name?.trim()].filter(Boolean).join(' ') ||
      contact?.name?.trim() ||
      null
    return {
      id,
      status: row.status as ConversationStatus,
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
      lastMessageAt: (row.last_message_at as string | null) ?? null,
      visitorName: (row.visitor_name as string | null) ?? null,
      visitorEmail: (row.visitor_email as string | null) ?? null,
      visitorPhone: (row.visitor_phone as string | null) ?? null,
      lastMessage: (row.last_message as string | null) ?? null,
      channel: (row.channel as string) ?? 'widget',
      channelMetadata: meta,
      botStatus: (row.bot_status as string) ?? 'active',
      channelAccountName: pageId ? (pageNameMap[pageId] ?? pageId) : null,
      pinned: Boolean(row.pinned),
      starred: Boolean(row.starred),
      priority: ((row.priority as string) ?? 'normal') as ConversationPriority,
      contactId: (row.contact_id as string | null) ?? null,
      contactName,
      assignedUserId: (row.assigned_user_id as string | null) ?? null,
    }
  }

  const conversations = pageRows.map(rowToSummary)
  const pinned = pinnedRows.map(rowToSummary)

  return Response.json({
    conversations,
    pinned,
    page,
    pageSize,
    totalCount,
    totalPages,
  })
}
