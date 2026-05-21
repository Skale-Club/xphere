// src/lib/action-engine/resolve-tool.ts
// Resolves (orgId, toolName) → tool_config with nested integration credentials
// Called as second step in the webhook hot path (expect ~10-25ms with composite index)
//
// SEED-025 Phase F: routes through workflows WHERE kind='tool' only.
// The legacy tool_configs path has been removed.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { resolveWorkflowAsTool } from '@/lib/workflows/resolve'

// ToolConfigWithIntegration: the shape returned by the joined query
// Used by the webhook route to get both tool config and credentials in one DB call
export type ToolConfigWithIntegration = {
  id: string
  organization_id: string
  integration_id: string
  tool_name: string
  action_type: Database['public']['Enums']['action_type']
  config: Database['public']['Tables']['tool_configs']['Row']['config']
  fallback_message: string
  is_active: boolean
  integrations: {
    id: string
    encrypted_api_key: string
    location_id: string | null
    provider: Database['public']['Enums']['integration_provider']
    config: Database['public']['Tables']['integrations']['Row']['config']
  }
}

export async function resolveTool(
  orgId: string,
  toolName: string,
  supabase: SupabaseClient<Database>
): Promise<ToolConfigWithIntegration | null> {
  return resolveWorkflowAsTool(orgId, toolName, supabase)
}
