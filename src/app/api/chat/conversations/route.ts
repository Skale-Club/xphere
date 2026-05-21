// GET /api/chat/conversations
// Returns a paginated page of conversations for the active org, ordered by
// last activity. Pinned rows are returned separately and always rendered on top
// of every page by the UI. Auth-gated: returns 401 if no user session.
//
// Query params:
//   page              — 1-indexed page number (default 1)
//   pageSize          — items per page (default 30, max 100)
//   status            — single status value (back-compat) — one of the 5 values
//   statuses          — csv list of statuses to include (preferred for multi-select)
//   assigned          — 'me' (filter to conversations assigned to the current user)
//   assigned_user_id  — specific user id (or 'unassigned')
//   channel           — 'whatsapp' | 'instagram' | 'messenger' | 'sms' | 'voice' | 'widget' | 'web'
//   unread            — 'true' → only conversations unread by the current user (SEED-035)
//   priority          — csv ('urgent,high,normal') (SEED-035)
//   bot_status        — 'active' | 'paused' (SEED-035)
//   starred           — 'true' (SEED-035)
//   label_ids         — csv of label ids; matches conversations having ANY of these labels (SEED-035)
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
import type {
  ConversationSummary,
  ConversationPriority,
  ConversationStatus,
  ConversationLabel,
} from '@/types/chat'

export const runtime = 'nodejs'

const DEFAULT_PAGE_SIZE = 30
const MAX_PAGE_SIZE = 100

// Channel filter accepts either the raw DB value ('widget') or the design-
// system label ('web'). We normalize 'web' → 'widget' at query time.
const CHANNEL_ALIAS: Record<string, string> = {
  web: 'widget',
}

const SELECT_COLS =
  'id, status, created_at, updated_at, last_message_at, visitor_name, visitor_email, visitor_phone, last_message, channel, channel_metadata, bot_status, pinned, priority, contact_id, assigned_user_id, starred, wait_until, contacts:contact_id ( name )'

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

function parseCsv(value: string | null): string[] {
  if (!value) return []
  return value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
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

  const statusParam = url.searchParams.get('status')
  const statusesParam = parseCsv(url.searchParams.get('statuses'))
  const statuses = (statusesParam.length > 0
    ? statusesParam
    : statusParam
      ? [statusParam]
      : []
  ).filter((s): s is ConversationStatus => VALID_STATUSES.has(s as ConversationStatus))

  const assigned = url.searchParams.get('assigned')
  const assignedUserIdParam = url.searchParams.get('assigned_user_id')

  const channelParam = url.searchParams.get('channel')
  const channel = channelParam ? (CHANNEL_ALIAS[channelParam] ?? channelParam) : null

  const unreadOnly = url.searchParams.get('unread') === 'true'
  const starredOnly = url.searchParams.get('starred') === 'true'

  const priorities = parseCsv(url.searchParams.get('priority')).filter((p) =>
    VALID_PRIORITIES.has(p),
  )

  const botStatusParam = url.searchParams.get('bot_status')
  const botStatus =
    botStatusParam && VALID_BOT_STATUSES.has(botStatusParam) ? botStatusParam : null

  const labelIds = parseCsv(url.searchParams.get('label_ids'))

  const supabase = await createClient()

  // ─────────── Compute id sets for join-style filters ───────────
  // We resolve unread/labels filters into id lists up-front and use .in()
  // because Supabase JS query builder doesn't support arbitrary LEFT JOINs.

  // 1. Read-state: which conversations has the current user read?
  // We need this regardless of `unreadOnly` so we can decorate each row with
  // `is_unread`. Pull the full set; it's small (one row per read conv).
  const { data: readsData } = await supabase
    .from('conversation_reads')
    .select('conversation_id')
    .eq('user_id', user.id)
  const readSet = new Set((readsData ?? []).map((r) => r.conversation_id as string))

  // 2. Label filter: resolve label_ids → conversation_ids that have ANY of them.
  let labelConvIds: string[] | null = null
  if (labelIds.length > 0) {
    const { data: assignData } = await supabase
      .from('conversation_label_assignments')
      .select('conversation_id')
      .in('label_id', labelIds)
    labelConvIds = [
      ...new Set((assignData ?? []).map((r) => r.conversation_id as string)),
    ]
    // No matches → return an empty page early. Short-circuit avoids a
    // .in('id', []) which Supabase rejects.
    if (labelConvIds.length === 0) {
      return Response.json({
        conversations: [],
        pinned: [],
        page,
        pageSize,
        totalCount: 0,
        totalPages: 1,
      })
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function applyFilters<T extends { eq: any; in: any; is: any; not: any }>(qb: T): T {
    let q: T = qb
    if (statuses.length === 1) q = q.eq('status', statuses[0])
    else if (statuses.length > 1) q = q.in('status', statuses)
    if (assigned === 'me' && user) q = q.eq('assigned_user_id', user.id)
    if (assignedUserIdParam) {
      if (assignedUserIdParam === 'unassigned') {
        q = q.is('assigned_user_id', null)
      } else {
        q = q.eq('assigned_user_id', assignedUserIdParam)
      }
    }
    if (channel) q = q.eq('channel', channel)
    if (priorities.length === 1) q = q.eq('priority', priorities[0])
    else if (priorities.length > 1) q = q.in('priority', priorities)
    if (botStatus) q = q.eq('bot_status', botStatus)
    if (starredOnly) q = q.eq('starred', true)
    if (labelConvIds) q = q.in('id', labelConvIds)
    if (unreadOnly && readSet.size > 0) {
      // "not read by the current user" = id NOT IN readSet.
      // Supabase doesn't support arbitrary NOT IN with large lists ergonomically,
      // but `.not('id', 'in', '(uuid,uuid)')` works.
      const inList = `(${[...readSet].join(',')})`
      q = q.not('id', 'in', inList)
    }
    return q
  }

  // ─────────── Pinned (always full, no pagination) ───────────
  let pinnedQuery = supabase
    .from('conversations')
    .select(SELECT_COLS)
    .eq('pinned', true)
    .order('last_message_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pinnedQuery = applyFilters(pinnedQuery as any) as any

  const { data: pinnedData, error: pinnedErr } = await pinnedQuery
  if (pinnedErr) {
    console.error('[GET /api/chat/conversations] pinned', pinnedErr)
    return Response.json({ error: 'Failed to load conversations' }, { status: 500 })
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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pageQuery = applyFilters(pageQuery as any) as any

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
  const allConvIds = allRows.map((r) => r.id as string)

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

  // ─────────── Resolve labels for visible conversations ───────────
  const labelsByConvId = new Map<string, ConversationLabel[]>()
  if (allConvIds.length > 0) {
    const { data: assignments } = await supabase
      .from('conversation_label_assignments')
      .select('conversation_id, label_id')
      .in('conversation_id', allConvIds)

    const allLabelIds = [
      ...new Set((assignments ?? []).map((a) => a.label_id as string)),
    ]
    const labelMap = new Map<string, ConversationLabel>()
    if (allLabelIds.length > 0) {
      const { data: labelRows } = await supabase
        .from('conversation_labels')
        .select('id, name, color')
        .in('id', allLabelIds)
      for (const l of labelRows ?? []) {
        labelMap.set(l.id as string, {
          id: l.id as string,
          name: l.name as string,
          color: l.color as string,
        })
      }
    }
    for (const a of assignments ?? []) {
      const cid = a.conversation_id as string
      const lid = a.label_id as string
      const label = labelMap.get(lid)
      if (!label) continue
      const arr = labelsByConvId.get(cid) ?? []
      arr.push(label)
      labelsByConvId.set(cid, arr)
    }
  }

  function rowToSummary(row: Record<string, unknown>): ConversationSummary {
    const meta = (row.channel_metadata as Record<string, string>) ?? {}
    const pageId = meta?.page_id
    const id = row.id as string
    const contact = row.contacts as { name?: string | null } | null
    return {
      id,
      status: (row.status as ConversationStatus) ?? 'open',
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
      priority: ((row.priority as string) ?? 'normal') as ConversationPriority,
      contactId: (row.contact_id as string | null) ?? null,
      contactName: contact?.name?.trim() || null,
      assignedUserId: (row.assigned_user_id as string | null) ?? null,
      starred: Boolean(row.starred),
      waitUntil: (row.wait_until as string | null) ?? null,
      isUnread: !readSet.has(id),
      labels: labelsByConvId.get(id) ?? [],
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
