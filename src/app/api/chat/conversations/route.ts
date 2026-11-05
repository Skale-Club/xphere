// GET /api/chat/conversations
// Returns a paginated page of conversations for the active org, ordered by
// last activity. Pinned rows are returned separately and always rendered on top
// of every page by the UI. Auth-gated: returns 401 if no user session.
//
// Query params:
//   page      | 1-indexed page number (default 1)
//   pageSize  | items per page (default 30, max 100)
//   List filters take comma-separated values (any of them matches):
//   status           | open, pending, waiting, resolved, closed (none: everything but closed)
//   priority         | normal, high, urgent
//   botStatus        | active, paused
//   phone_number_id  | phone number ids
//   assignedUserIds  | user ids, plus 'unassigned'
//   labelIds         | label ids
//   channel          | whatsapp, instagram, messenger, sms, voice, widget, web
//   assigned         | 'me' (assigned to the current user)
//   starred | verified | unread | pinned  | '1' to keep only those
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
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

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
  // Every list filter takes comma-separated values; one value is just a list of one.
  const list = (name: string) =>
    (url.searchParams.get(name) ?? '').split(',').map((v) => v.trim()).filter(Boolean)
  const statuses = list('status').filter((s) => VALID_STATUSES.has(s as ConversationStatus))
  const assigned = url.searchParams.get('assigned')
  const channelParam = url.searchParams.get('channel')
  const starred = url.searchParams.get('starred') === '1'
  const verifiedOnly = url.searchParams.get('verified') === '1'
  const unreadOnly = url.searchParams.get('unread') === '1'
  const pinnedOnly = url.searchParams.get('pinned') === '1'
  const priorities = list('priority').filter((p) => VALID_PRIORITIES.has(p))
  const botStatuses = list('botStatus').filter((b) => VALID_BOT_STATUSES.has(b))
  const phoneNumberIds = list('phone_number_id').filter((id) => UUID.test(id))
  const assigneeValues = list('assignedUserIds')
  const assignedUserIds = assigneeValues.filter((id) => UUID.test(id))
  const labelIds = list('labelIds').filter((id) => UUID.test(id))
  // Supports comma-separated values for multi-channel filtering (additive).
  const channels = channelParam
    ? channelParam.split(',').map((c) => CHANNEL_ALIAS[c] ?? c).filter(Boolean)
    : []

  const supabase = await createClient()

  // ─────────── Contact-centric inbox via RPC ───────────
  // inbox_entries returns ONE representative conversation per contact (anonymous
  // conversations are their own entry), with the contact's channel set + pinned
  // flag, ordered by activity. We then hydrate the representative ids with the
  // full SELECT_COLS embeds (contact/phone/verifications) so the response shape
  // is unchanged — only the grouping moves into SQL.
  const rpcArgs = {
    p_user: userId,
    p_assigned: assigned === 'me' ? 'me' : null,
    p_channels: channels.length > 0 ? channels : null,
    p_starred: starred,
    p_verified: verifiedOnly,
    p_statuses: statuses.length > 0 ? statuses : null,
    p_priorities: priorities.length > 0 ? priorities : null,
    p_bot_statuses: botStatuses.length > 0 ? botStatuses : null,
    p_phone_number_ids: phoneNumberIds.length > 0 ? phoneNumberIds : null,
    p_assigned_user_ids: assignedUserIds.length > 0 ? assignedUserIds : null,
    p_include_unassigned: assigneeValues.includes('unassigned'),
    p_label_ids: labelIds.length > 0 ? labelIds : null,
    p_unread_only: unreadOnly,
  }

  type EntryRow = {
    representative_conversation_id: string
    contact_id: string | null
    // Effective display channel from inbox_entries: message-less 'manual'
    // placeholders are re-derived to the contact's reachable channel (sms/email)
    // so the Inbox badge matches the composer and never goes stale.
    representative_channel: string | null
    channels: string[] | null
    pinned: boolean
    // Unread flag computed by the RPC on the representative (keyed on inbound
    // activity vs this user's read marker). Single source of truth shared with
    // the sidebar Chat badge (inbox_unread_count) so they can never drift.
    is_unread: boolean
  }

  // "Pinned" in the filter panel: only the pinned section, no paged list below it.
  const noUnpinned = { data: [], error: null }
  const zeroCount = { data: 0, error: null }
  const [pinnedEntriesRes, pageEntriesRes, countRes] = await Promise.all([
    supabase.rpc('inbox_entries', { ...rpcArgs, p_pinned: true, p_limit: 1000, p_offset: 0 }),
    pinnedOnly
      ? Promise.resolve(noUnpinned)
      : supabase.rpc('inbox_entries', {
          ...rpcArgs,
          p_pinned: false,
          p_limit: pageSize,
          p_offset: (page - 1) * pageSize,
        }),
    pinnedOnly ? Promise.resolve(zeroCount) : supabase.rpc('inbox_entries_count', { ...rpcArgs, p_pinned: false }),
  ])

  const entriesErr = pinnedEntriesRes.error ?? pageEntriesRes.error ?? countRes.error
  if (entriesErr) {
    console.error('[GET /api/chat/conversations] inbox_entries', entriesErr)
    return Response.json(
      { error: 'Failed to load conversations', detail: entriesErr.message },
      { status: 500 },
    )
  }

  const pinnedEntries = (pinnedEntriesRes.data ?? []) as EntryRow[]
  const pageEntries = (pageEntriesRes.data ?? []) as EntryRow[]
  const totalCount = Number(countRes.data ?? 0)
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize))

  // Channel set + effective representative channel + unread flag per rep conv id.
  const channelsById = new Map<string, string[]>()
  const effChannelById = new Map<string, string | null>()
  const unreadById = new Map<string, boolean>()
  for (const e of [...pinnedEntries, ...pageEntries]) {
    channelsById.set(e.representative_conversation_id, e.channels ?? [])
    effChannelById.set(e.representative_conversation_id, e.representative_channel ?? null)
    unreadById.set(e.representative_conversation_id, Boolean(e.is_unread))
  }

  // Hydrate representative ids with the full embeds in a single query.
  const repIds = [
    ...pinnedEntries.map((e) => e.representative_conversation_id),
    ...pageEntries.map((e) => e.representative_conversation_id),
  ]
  const rowsById = new Map<string, Record<string, unknown>>()

  if (repIds.length > 0) {
    // Unread state comes from the RPC's is_unread flag (unreadById); here we only
    // hydrate the representative rows with their full embeds.
    const hydrateRes = await supabase.from('conversations').select(SELECT_COLS).in('id', repIds)

    if (hydrateRes.error) {
      console.error('[GET /api/chat/conversations] hydrate', hydrateRes.error)
      return Response.json({ error: 'Failed to load conversations' }, { status: 500 })
    }

    for (const r of (hydrateRes.data ?? []) as Record<string, unknown>[]) {
      rowsById.set(r.id as string, r)
    }
  }

  // Preserve RPC ordering (activity desc); attach the contact's channel set.
  const mapEntries = (entries: EntryRow[]): Record<string, unknown>[] => {
    const out: Record<string, unknown>[] = []
    for (const e of entries) {
      const row = rowsById.get(e.representative_conversation_id)
      if (!row) continue
      // Override the stored channel with the RPC's effective channel so the
      // badge reflects reachability for 'manual' placeholders.
      const eff = effChannelById.get(e.representative_conversation_id)
      out.push({
        ...row,
        channel: eff ?? row.channel,
        __channels: channelsById.get(e.representative_conversation_id) ?? [],
      })
    }
    return out
  }

  const pinnedRows = mapEntries(pinnedEntries)
  const pageRows = mapEntries(pageEntries)

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
    const lastActivity = (row.last_message_at as string | null) ?? null
    // Unread is the RPC's representative-level flag (keyed on inbound activity),
    // shared with the sidebar badge so the list dot and the count never disagree.
    const isUnread = unreadById.get(id) ?? false

    return {
      id,
      status: row.status as ConversationStatus,
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
      lastMessageAt: lastActivity,
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
      channels: (row.__channels as string[] | undefined) ?? [row.channel as string],
      isUnread,
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
