// src/lib/calls/resolve-routing.ts
// Given an org + (optional) user, resolves which routing_mode to use and which
// destination TwiML to render.
//
// Resolution order:
//   1. If a user_id is provided, prefer that user's call_settings row
//   2. Otherwise, pick the org's first/oldest call_settings row (admin default)
//   3. If no settings exist, return null (caller renders <Hangup/>)

import { createServiceRoleClient } from '@/lib/supabase/admin'
import type { Database, CallRoutingMode } from '@/types/database'

type CallSettingsRow = Database['public']['Tables']['call_settings']['Row']

export interface ResolvedRouting {
  userId: string
  routingMode: CallRoutingMode
  phoneForward: string | null
  sipUsername: string | null
  twilioClientIdentity: string | null
  recordCalls: boolean
}

export async function resolveRoutingForOrg(
  orgId: string,
  preferUserId?: string,
): Promise<ResolvedRouting | null> {
  const supabase = createServiceRoleClient()

  if (preferUserId) {
    const { data } = await supabase
      .from('call_settings')
      .select('*')
      .eq('org_id', orgId)
      .eq('user_id', preferUserId)
      .maybeSingle()
    if (data) return toResolved(data)
  }

  const { data: anyRow } = await supabase
    .from('call_settings')
    .select('*')
    .eq('org_id', orgId)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  return anyRow ? toResolved(anyRow) : null
}

function toResolved(row: CallSettingsRow): ResolvedRouting {
  return {
    userId: row.user_id,
    routingMode: row.routing_mode,
    phoneForward: row.phone_forward,
    sipUsername: row.sip_username,
    twilioClientIdentity: row.twilio_client_identity,
    recordCalls: row.record_calls,
  }
}

/**
 * Build a SIP URI from the user's sip_username + the org's Twilio SIP domain.
 * The domain lives in the Twilio integration's config as `sip_domain` (e.g.
 * `acme.sip.twilio.com`). Falls back to a sane default if not configured —
 * the dial will fail loudly at Twilio rather than silently misroute.
 */
export function buildSipUri(
  sipUsername: string | null,
  sipDomain: string | null,
): string | null {
  if (!sipUsername || !sipDomain) return null
  return `sip:${sipUsername}@${sipDomain}`
}
