// src/lib/action-engine/resolve-tool-by-id.ts
// Sibling of resolveTool — keyed by tool_config.id (UUID FK from manychat_rules.tool_config_id).
// Used by the ManyChat dispatcher (src/lib/manychat/dispatch-event.ts) where the rule already
// names the tool by id rather than by name.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import type { ToolConfigWithIntegration } from './resolve-tool'

export async function resolveToolById(
  toolConfigId: string,
  supabase: SupabaseClient<Database>
): Promise<ToolConfigWithIntegration | null> {
  const { data, error } = await supabase
    .from('tool_configs')
    .select('*, integrations!inner(*)')
    .eq('id', toolConfigId)
    .eq('is_active', true)
    .single<ToolConfigWithIntegration>()

  if (error || !data?.integrations?.encrypted_api_key) return null
  return data
}
