'use server'

/**
 * Home dashboard server actions.
 *
 * Currently only the unified activity-feed loader lives here.
 */

import { createClient, getUser } from '@/lib/supabase/server'
import { formatPhoneDisplay } from '@/lib/phone-numbers/format'
import type { ActivityFeedEvent, ActivityFeedFilter } from './activity-feed-types'

/**
 * Server action used by the dashboard ActivityFeed client component to
 * paginate further into the unified feed. Returns the next batch sorted
 * by timestamp DESC.
 *
 * Implementation pulls 4 source tables in parallel within each shard and
 * mergesorts. Each individual query is bounded to `limit + offset` so a
 * page of 15 events past offset 30 still pulls at most 45 rows from each
 * source | fine at dashboard scale.
 */
export async function getActivityFeed(
  offset: number,
  filter: ActivityFeedFilter = 'all',
  limit = 15,
): Promise<ActivityFeedEvent[]> {
  const user = await getUser()
  if (!user) return []

  const supabase = await createClient()
  const fetchAll = filter === 'all'
  const cap = offset + limit

  type MsgRow = {
    id: string
    role: string
    content: string
    created_at: string
    conversation_id: string
    conversations: {
      id: string
      channel: string | null
      visitor_name: string | null
      contacts: { name: string | null } | null
    } | null
  }

  type CallRow = {
    id: string
    direction: 'inbound' | 'outbound'
    status: string | null
    duration_seconds: number | null
    started_at: string | null
    created_at: string
    from_number: string | null
    to_number: string | null
    contacts: { name: string | null } | null
  }

  type ActRow = {
    id: string
    type: string
    content: string | null
    created_at: string
    opportunity_id: string
    opportunities: { title: string | null } | null
  }

  // Messages
  async function fetchMessages(): Promise<ActivityFeedEvent[]> {
    if (!(fetchAll || filter === 'messages')) return []
    const { data: msgs } = await supabase
      .from('conversation_messages')
      .select(
        `id, role, content, created_at, conversation_id,
         conversations:conversation_id ( id, channel, visitor_name, contacts:contact_id ( name ) )`,
      )
      .order('created_at', { ascending: false })
      .limit(cap)

    const out: ActivityFeedEvent[] = []
    for (const m of (msgs as unknown as MsgRow[] | null) ?? []) {
      const who =
        m.conversations?.contacts?.name ||
        m.conversations?.visitor_name ||
        (m.role === 'assistant' ? 'Agent' : 'Visitor')
      const preview = (m.content ?? '').slice(0, 120)
      out.push({
        id: `msg-${m.id}`,
        type: 'message',
        title: `New message from ${who}`,
        description: preview,
        timestamp: m.created_at,
        href: `/inbox?conversation=${m.conversation_id}`,
        channel: m.conversations?.channel ?? null,
      })
    }
    return out
  }

  // Calls
  async function fetchCalls(): Promise<ActivityFeedEvent[]> {
    if (!(fetchAll || filter === 'calls')) return []
    const { data: calls } = await supabase
      .from('call_logs')
      .select(
        `id, direction, status, duration_seconds, started_at, created_at, from_number, to_number,
         contacts:contact_id ( name )`,
      )
      .order('started_at', { ascending: false, nullsFirst: false })
      .limit(cap)

    const out: ActivityFeedEvent[] = []
    for (const c of (calls as unknown as CallRow[] | null) ?? []) {
      const phone = c.direction === 'inbound' ? c.from_number : c.to_number
      const name = c.contacts?.name || (phone ? formatPhoneDisplay(phone) : null) || 'Unknown'
      const verb = c.direction === 'inbound' ? 'inbound from' : 'outbound to'
      out.push({
        id: `call-${c.id}`,
        type: 'call',
        title: `Call ${verb} ${name}`,
        description: `${c.status ?? 'unknown'} · ${c.duration_seconds ?? 0}s`,
        timestamp: c.started_at ?? c.created_at,
        href: `/calls?call=${c.id}`,
        channel: 'voice',
      })
    }
    return out
  }

  // Opportunity activities
  async function fetchDeals(): Promise<ActivityFeedEvent[]> {
    if (!(fetchAll || filter === 'deals')) return []
    const { data: acts } = await supabase
      .from('opportunity_activities')
      .select(
        `id, type, content, created_at, opportunity_id,
         opportunities:opportunity_id ( title )`,
      )
      .order('created_at', { ascending: false })
      .limit(cap)

    const out: ActivityFeedEvent[] = []
    for (const a of (acts as unknown as ActRow[] | null) ?? []) {
      const title = a.opportunities?.title ?? 'Opportunity'
      let label = a.type as string
      if (label === 'stage_change') label = 'Stage changed'
      else if (label === 'created') label = 'Created'
      else if (label === 'won') label = 'Won'
      else if (label === 'lost') label = 'Lost'
      out.push({
        id: `opp-${a.id}`,
        type: a.type === 'won' ? 'agent' : a.type === 'lost' ? 'error' : 'tool',
        title: `${label}: ${title}`,
        description: a.content ?? undefined,
        timestamp: a.created_at,
        href: `/pipeline/${a.opportunity_id}`,
        channel: null,
      })
    }
    return out
  }

  // Reviews
  async function fetchReviews(): Promise<ActivityFeedEvent[]> {
    if (!(fetchAll || filter === 'reviews')) return []
    const { data: revs } = await supabase
      .from('google_reviews')
      .select(`id, rating, reviewer_name, text, first_seen_at`)
      .order('first_seen_at', { ascending: false })
      .limit(cap)

    const out: ActivityFeedEvent[] = []
    for (const r of revs ?? []) {
      out.push({
        id: `rev-${r.id}`,
        type: 'review',
        title: `${r.rating}★ review from ${r.reviewer_name ?? 'anonymous'}`,
        description: r.text ?? undefined,
        timestamp: r.first_seen_at,
        href: '/reviews',
        channel: null,
      })
    }
    return out
  }

  const [msgEvents, callEvents, dealEvents, reviewEvents] = await Promise.all([
    fetchMessages(),
    fetchCalls(),
    fetchDeals(),
    fetchReviews(),
  ])

  const events: ActivityFeedEvent[] = []
  events.push(...msgEvents, ...callEvents, ...dealEvents, ...reviewEvents)

  events.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
  return events.slice(offset, offset + limit)
}
