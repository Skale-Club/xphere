// SEED-025 Phase D: integration health helpers consumed by the UI and the
// SEED-026 capability spec.
//
// The workflow builder (manual + AI) filters its integration palette by
// health_status. The spec endpoint returns only `connected` integrations.
// When an integration is `degraded` we still allow it (intermittent blips),
// but we surface a warning. `disconnected` hides the integration entirely
// and the periodic job marks dependent workflows as health_blocked.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

export type IntegrationHealth = 'connected' | 'degraded' | 'disconnected' | 'unknown'

export interface IntegrationHealthRow {
  id: string
  provider: string
  name: string
  health_status: IntegrationHealth
  last_checked_at: string | null
  last_error: string | null
  failure_count: number
}

// Returns integrations the workflow builder is allowed to expose for an org.
// 'connected' and 'degraded' are usable; 'disconnected' and 'unknown' are hidden.
export async function listAvailableIntegrations(
  orgId: string,
  supabase: SupabaseClient<Database>,
): Promise<IntegrationHealthRow[]> {
  const { data, error } = await supabase
    .from('integrations')
    .select('id, provider, name, health_status, last_checked_at, last_error, failure_count')
    .eq('organization_id', orgId)
    .eq('is_active', true)
    .in('health_status', ['connected', 'degraded'])

  if (error || !data) return []
  return data as IntegrationHealthRow[]
}

// Full picture (including disconnected) — used by the /integrations page so
// the user can see what needs reconnecting.
export async function listIntegrationHealth(
  orgId: string,
  supabase: SupabaseClient<Database>,
): Promise<IntegrationHealthRow[]> {
  const { data, error } = await supabase
    .from('integrations')
    .select('id, provider, name, health_status, last_checked_at, last_error, failure_count')
    .eq('organization_id', orgId)
    .eq('is_active', true)
    .order('provider')

  if (error || !data) return []
  return data as IntegrationHealthRow[]
}
