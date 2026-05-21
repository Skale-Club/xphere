// src/lib/action-engine/resolve-tool-by-id.ts
// Sibling of resolveTool | keyed by tool_config.id (UUID FK from manychat_rules.tool_config_id).
// Used by the ManyChat dispatcher (src/lib/manychat/dispatch-event.ts) where the rule already
// names the tool by id rather than by name.
//
// SEED-025 Phase F: routes through workflows only. Legacy tool_configs path removed.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import type { ToolConfigWithIntegration } from './resolve-tool'
import { resolveWorkflowAsToolById } from '@/lib/workflows/resolve'

export async function resolveToolById(
  toolConfigId: string,
  supabase: SupabaseClient<Database>
): Promise<ToolConfigWithIntegration | null> {
  return resolveWorkflowAsToolById(toolConfigId, supabase)
}
