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
  'id, status, created_at, updated_at, last_message_at, last_inbound_at, visitor_name, visitor_email, visitor_phone, last_message, channel, channel_metadata, bot_status, pinned, priority, contact_id, assigned_user_id, starred, wait_until, phone_number_id, contacts:contact_id ( first_name, last_name, name, avatar_url, contact_verifications ( id ) ), phone_number:phone_number_id ( id, e164, friendly_name, inbox_label )'

const VALID_STATUSES = new Set<ConversationStatus>([
  'open',
  'pending',
  'waiting',
  'resolved',
  'closed',
])
const VALID_PRIORITIES = new Set(['normal', 'high', 'urgent'])
const VALID_BOT_STATUSES = new Set(['active', 'paused'])

interface FilterableQuery {
  eq(column: string, value: unknown): FilterableQuery
  neq(column: string, value: unknown): FilterableQuery
  in(column: string, values: unknown[]): FilterableQuery
}

function clampInt(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback
  return Math.max(min, Math.min(max, Math.floor(value)))
}

function activityMillis(row: Record<string, unknown>): number {
  const value = (row.last_message_at ?? row.updated_at ?? row.created_at) as string | null | undefined
  const time = value ? new Date(value).getTime() : 0
  return Number.isFinite(time) ? time : 0
}

function compareActivityDesc(a: Record<string, unknown>, b: Record<string, unknown>): number {
  const diff = activityMillis(b) - activityMillis(a)
  if (diff !== 0) return diff
  const aCreated = new Date((a.created_at as string | null | undefined) ?? 0).getTime()
  const bCreated = new Date((b.created_at as string | null | undefined) ?? 0).getTime()
  return bCreated - aCreated
}

export async function GET(request: Request): Promise<Response> {
  const user = await getUser()
  if (!user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const userId = user.id

  const url = new URL(request.url)
  const page = clampInt(Number(url.searchParams.get('page') ?? 1), 1, 100_000, 1)
  const pageSize = clampInt(
    Number(url.searchParams.get('pageSize') ?? DEFAULT_PAGE_SIZE),
    1,
    MAX_PAGE_SIZE,
    DEFAULT_PAGE_SIZE,
  )
  const statusParam = url.searchParams.get('status')
  const status = statusParam && VALID_STATUSES.has(statusParam as ConversationStatus)
    ? (statusParam as ConversationStatus)
    : null
  const assigned = url.searchParams.get('assigned')
  const channelParam = url.searchParams.get('channel')
  const starred = url.searchParams.get('starred') === '1'
  const verifiedOnly = url.searchParams.get('verified') === '1'
  const priority = url.searchParams.get('priority')
  const botStatus = url.searchParams.get('botStatus')
  const phoneNumberId = url.searchParams.get('phone_number_id')
  // Supports comma-separated values for multi-channel filtering (additive).
  const channels = channelParam
    ? channelParam.split(',').map((c) => CHANNEL_ALIAS[c] ?? c).filter(Boolean)
    : []

  const supabase = await createClient()

  // ─────────── Verified-only filter ───────────
  // PostgREST can't easily push an EXISTS over an embedded resource into the
  // top-level WHERE, so we resolve the set of verified contact ids first and
  // narrow both queries with `.in('contact_id', …)`. Empty set → empty inbox.
  let verifiedContactIds: string[] | null = null
  if (verifiedOnly) {
    const { data: verifiedRows, error: verifiedErr } = await supabase
      .from('contact_verifications')
      .select('contact_id')
    if (verifiedErr) {
      console.error('[GET /api/chat/conversations] verified-prefetch', verifiedErr)
      return Response.json(
        { error: 'Failed to load conversations', detail: verifiedErr.message },
        { status: 500 },
      )
    }
    verifiedContactIds = Array.from(
      new Set((verifiedRows ?? []).map((r) => r.contact_id as string).filter(Boolean)),
    )
    if (verifiedContactIds.length === 0) {
      return Response.json({
        conversations: [],
        pinned: [],
        page,
        pageSize,
        totalCount: 0,
        totalPages: 0,
      })
    }
  }

  // ─────────── Pinned (always full, no pagination) ───────────
  function applyFilters<T>(query: T): T {
    let q = query as never as FilterableQuery
    if (status) q = q.eq('status', status)
    else q = q.neq('status', 'closed')
    if (assigned === 'me') q = q.eq('assigned_user_id', userId)
    if (channels.length === 1) q = q.eq('channel', channels[0])
    else if (channels.length > 1) q = q.in('channel', channels)
    if (starred) q = q.eq('starred', true)
    if (verifiedContactIds) q = q.in('contact_id', verifiedContactIds)
    if (priority && VALID_PRIORITIES.has(priority)) q = q.eq('priority', priority)
    if (botStatus && VALID_BOT_STATUSES.has(botStatus)) q = q.eq('bot_status', botStatus)
    if (phoneNumberId) q = q.eq('phone_number_id', phoneNumberId)
    return q as never as T
  }

  const pinnedWithMessagesQuery = applyFilters(
    supabase
      .from('conversations')
      .select(SELECT_COLS)
      .eq('pinned', true)
      .not('last_message_at', 'is', null)
      .order('last_message_at', { ascending: false })
      .order('created_at', { ascending: false }),
  )
  const pinnedWithoutMessagesQuery = applyFilters(
    supabase
      .from('conversations')
      .select(SELECT_COLS)
      .eq('pinned', true)
      .is('last_message_at', null)
      .order('updated_at', { ascending: false })
      .order('created_at', { ascending: false }),
  )
  const [
    { data: pinnedWithMessages, error: pinnedWithMessagesErr },
    { data: pinnedWithoutMessages, error: pinnedWithoutMessagesErr },
  ] = await Promise.all([pinnedWithMessagesQuery, pinnedWithoutMessagesQuery])
  const pinnedErr = pinnedWithMessagesErr ?? pinnedWithoutMessagesErr
  if (pinnedErr) {
    console.error('[GET /api/chat/conversations] pinned', pinnedErr)
    return Response.json({ error: 'Failed to load conversations', detail: pinnedErr.message }, { status: 500 })
  }
  const pinnedRows = [
    ...((pinnedWithMessages ?? []) as Record<string, unknown>[]),
    ...((pinnedWithoutMessages ?? []) as Record<string, unknown>[]),
  ].sort(compareActivityDesc)

  // ─────────── Unpinned page (range + exact count) ───────────
  const from = (page - 1) * pageSize
  const to = from + pageSize - 1

  const countQuery = applyFilters(
    supabase
      .from('conversations')
      .select('id', { count: 'exact', head: true })
      .eq('pinned', false),
  )

  const { count, error: countErr } = await countQuery
  if (countErr) {
    console.error('[GET /api/chat/conversations] count', countErr)
    return Response.json({ error: 'Failed to load conversations' }, { status: 500 })
  }

  const totalCount = count ?? 0
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize))
  let pageRows: Record<string, unknown>[] = []

  if (totalCount > 0 && from < totalCount) {
    const candidateTo = Math.min(to, totalCount - 1)
    const withMessagesQuery = applyFilters(
      supabase
        .from('conversations')
        .select(SELECT_COLS)
        .eq('pinned', false)
        .not('last_message_at', 'is', null)
        .order('last_message_at', { ascending: false })
        .order('created_at', { ascending: false })
        .range(0, candidateTo),
    )
    const withoutMessagesQuery = applyFilters(
      supabase
        .from('conversations')
        .select(SELECT_COLS)
        .eq('pinned', false)
        .is('last_message_at', null)
        .order('updated_at', { ascending: false })
        .order('created_at', { ascending: false })
        .range(0, candidateTo),
    )
    const [
      { data: withMessages, error: withMessagesErr },
      { data: withoutMessages, error: withoutMessagesErr },
    ] = await Promise.all([withMessagesQuery, withoutMessagesQuery])
    const pageErr = withMessagesErr ?? withoutMessagesErr
    if (pageErr) {
      console.error('[GET /api/chat/conversations] page', pageErr)
      return Response.json({ error: 'Failed to load conversations' }, { status: 500 })
    }
    pageRows = [
      ...((withMessages ?? []) as Record<string, unknown>[]),
      ...((withoutMessages ?? []) as Record<string, unknown>[]),
    ].sort(compareActivityDesc).slice(from, to + 1)
  }

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
    const contact = row.contacts as {
      first_name?: string | null
      last_name?: string | null
      name?: string | null
      avatar_url?: string | null
      contact_verifications?: Array<{ id: string }> | null
    } | null
    const contactName =
      [contact?.first_name?.trim(), contact?.last_name?.trim()].filter(Boolean).join(' ') ||
      contact?.name?.trim() ||
      null
    const contactAvatarUrl = contact?.avatar_url?.trim() || null
    const contactVerified = Array.isArray(contact?.contact_verifications)
      && contact!.contact_verifications!.length > 0
    const phoneNumber = row.phone_number as
      | { id: string; e164: string | null; friendly_name: string | null; inbox_label: string | null }
      | null
    const phoneNumberLabel = phoneNumber
      ? (phoneNumber.inbox_label?.trim() || phoneNumber.friendly_name?.trim() || phoneNumber.e164 || null)
      : null
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
      contactAvatarUrl,
      contactVerified,
      assignedUserId: (row.assigned_user_id as string | null) ?? null,
      phoneNumberId: (row.phone_number_id as string | null) ?? null,
      phoneNumberLabel,
      lastInboundAt: (row.last_inbound_at as string | null) ?? null,
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
