import 'server-only'

// Keeps the Ads Command Engine's Business Profile targets in step with Local
// SEO. Every Local SEO location linked to a profile is one engine target: an
// ads_connections row (platform 'google_business', ad_account_id
// accounts/{a}/locations/{l}) whose credential is a reference to the
// gbp_connections row that owns the OAuth tokens. That row is what MCP, the
// Copilot, workflows and Ads → Changes see; Local SEO stays the only place
// where a Business Profile is connected.

import type { SupabaseClient } from '@supabase/supabase-js'

import { encrypt } from '@/lib/crypto'
import { gbpConnectionCredential } from '@/lib/google-business/api'
import type { Database } from '@/types/database'

type Admin = SupabaseClient<Database>

export function gbpTargetName(accountName: string, locationName: string): string {
  return `${accountName}/${locationName}`
}

/** The engine target of a linked location, or null when it is not linked. */
export function locationTarget(location: { gbp_account_name: string | null; gbp_location_name: string | null }): string | null {
  return location.gbp_account_name && location.gbp_location_name
    ? gbpTargetName(location.gbp_account_name, location.gbp_location_name)
    : null
}

export async function upsertEngineTarget(
  admin: Admin,
  input: { orgId: string; connectionId: string; accountName: string; locationName: string; title: string },
): Promise<{ error: string | null }> {
  const { error } = await admin.from('ads_connections').upsert(
    {
      org_id: input.orgId,
      platform: 'google_business',
      ad_account_id: gbpTargetName(input.accountName, input.locationName),
      ad_account_name: input.title,
      encrypted_access_token: await encrypt(gbpConnectionCredential(input.connectionId)),
      gbp_connection_id: input.connectionId,
      // Durable refresh token lives in gbp_connections; no expiry to watch here.
      token_expires_at: null,
      status: 'active',
      health: 'ok',
      connection_error: null,
      last_error_at: null,
      last_verified_at: new Date().toISOString(),
    },
    { onConflict: 'org_id,platform,ad_account_id' },
  )
  return { error: error?.message ?? null }
}

/**
 * Clear the engine's error flag on every target of a login. The engine marks a
 * target unusable on a 401/403; the login is the thing that gets fixed
 * (reconnect), so the targets have to follow it.
 */
export async function markEngineTargetsHealthy(admin: Admin, orgId: string, connectionId: string): Promise<void> {
  await admin
    .from('ads_connections')
    .update({ health: 'ok', connection_error: null, last_verified_at: new Date().toISOString() })
    .eq('org_id', orgId)
    .eq('gbp_connection_id', connectionId)
    .eq('health', 'error')
}

/**
 * Drop the engine target of a location being unlinked — unless another Local
 * SEO location of the org still points at the same profile.
 */
export async function removeEngineTarget(admin: Admin, input: { orgId: string; locationId: string; target: string }): Promise<void> {
  const [accountName, ...rest] = input.target.split('/locations/')
  const { data: others } = await admin
    .from('local_seo_locations')
    .select('id')
    .eq('org_id', input.orgId)
    .eq('gbp_account_name', accountName)
    .eq('gbp_location_name', `locations/${rest.join('/locations/')}`)
    .neq('id', input.locationId)
    .limit(1)
  if (others?.length) return
  await admin.from('ads_connections').delete().eq('org_id', input.orgId).eq('platform', 'google_business').eq('ad_account_id', input.target)
}
