// Visitor → contact identification.
//
// Links an anonymous analytics visitor to a known contact so the CAPI sender can
// resolve the visitor's click signals (fbc/fbp/ip/ua) when a Lead/Purchase
// fires. Sets analytics_visitors.contact_id and back-fills recent un-linked
// analytics_events for that visitor. Service-role only (no RLS context here).

import { createServiceRoleClient } from '@/lib/supabase/admin'
import type { SupabaseClient } from '@supabase/supabase-js'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any, any, any>

export interface ClickSignals {
  fbc: string | null
  fbp: string | null
  client_ip_address: string | null
  client_user_agent: string | null
}

/**
 * Attach a visitor to a contact. Idempotent. Returns true when a row was linked.
 */
export async function linkVisitorToContact(
  orgId: string,
  visitorKey: string,
  contactId: string,
  options: { supabase?: Db } = {},
): Promise<boolean> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (options.supabase ?? createServiceRoleClient()) as any

  const { data: visitor } = await supabase
    .from('analytics_visitors')
    .update({ contact_id: contactId, is_identified: true })
    .eq('organization_id', orgId)
    .eq('visitor_key', visitorKey)
    .select('id')
    .maybeSingle()

  if (!visitor) return false

  // Back-fill recent events that fired before the contact existed.
  await supabase
    .from('analytics_events')
    .update({ contact_id: contactId })
    .eq('organization_id', orgId)
    .eq('visitor_id', visitor.id)
    .is('contact_id', null)

  return true
}

/**
 * Resolve the freshest click signals for a contact via its linked visitor's
 * most recent session. Returns nulls when the contact was never tied to a
 * tracked session (e.g. an external form with no Xphere script). The CAPI
 * sender still fires on email/phone alone in that case (lower match quality).
 */
export async function resolveClickSignals(
  orgId: string,
  contactId: string,
  options: { supabase?: Db } = {},
): Promise<ClickSignals> {
  const empty: ClickSignals = {
    fbc: null, fbp: null, client_ip_address: null, client_user_agent: null,
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (options.supabase ?? createServiceRoleClient()) as any

  const { data: visitor } = await supabase
    .from('analytics_visitors')
    .select('id')
    .eq('organization_id', orgId)
    .eq('contact_id', contactId)
    .order('last_seen_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!visitor) return empty

  const { data: session } = await supabase
    .from('analytics_sessions')
    .select('fbc, fbp, client_ip_address, client_user_agent')
    .eq('organization_id', orgId)
    .eq('visitor_id', visitor.id)
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!session) return empty
  return {
    fbc: session.fbc ?? null,
    fbp: session.fbp ?? null,
    client_ip_address: session.client_ip_address ?? null,
    client_user_agent: session.client_user_agent ?? null,
  }
}

/**
 * Find the most recent browser-generated event_id for a contact's visitor
 * (stored in analytics_events.metadata.event_id on form_submit). Used to dedup
 * the server-side Lead against the browser Pixel Lead. Null when unavailable.
 */
export async function resolveBrowserEventId(
  orgId: string,
  contactId: string,
  options: { supabase?: Db } = {},
): Promise<string | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (options.supabase ?? createServiceRoleClient()) as any

  const { data: ev } = await supabase
    .from('analytics_events')
    .select('metadata')
    .eq('organization_id', orgId)
    .eq('contact_id', contactId)
    .eq('event_type', 'form_submit')
    .order('occurred_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const eid = ev?.metadata?.event_id
  return typeof eid === 'string' && eid ? eid : null
}
