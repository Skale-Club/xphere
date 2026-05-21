// SEED-025 Phase F: unified workflow list query (single source of truth).
//
// Reads exclusively from the workflows table. The legacy tool_configs fallback
// has been removed as part of the Phase F cutover.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

export interface UnifiedWorkflow {
  id: string
  name: string
  slug: string
  description: string | null
  is_active: boolean
  kind: 'tool' | 'flow'
  trigger_type: 'tool_call' | 'event' | 'schedule' | 'manual' | 'webhook_url'
  trigger_config: Record<string, unknown>
  health_blocked: boolean
  health_blocked_reason: string | null
  updated_at: string
  folder_id: string | null
  position: number
  archived_at: string | null
}

export interface ListWorkflowsOptions {
  includeArchived?: boolean
}

export async function listUnifiedWorkflows(
  orgId: string,
  supabase: SupabaseClient<Database>,
  options: ListWorkflowsOptions = {},
): Promise<UnifiedWorkflow[]> {
  let query = supabase
    .from('workflows')
    .select(
      'id, name, slug, description, is_active, kind, trigger_type, trigger_config, health_blocked, health_blocked_reason, updated_at, folder_id, position, archived_at, deleted_at',
    )
    .eq('org_id', orgId)
    .is('deleted_at', null)
    .order('position', { ascending: true })
    .order('updated_at', { ascending: false })

  if (!options.includeArchived) {
    query = query.is('archived_at', null)
  }

  const { data: rows, error } = await query

  if (error || !rows) return []

  const fromWorkflows: UnifiedWorkflow[] = rows.map((r) => ({
    id: r.id as string,
    name: r.name as string,
    slug: r.slug as string,
    description: r.description as string | null,
    is_active: r.is_active as boolean,
    kind: r.kind as 'tool' | 'flow',
    trigger_type: r.trigger_type as UnifiedWorkflow['trigger_type'],
    trigger_config: (r.trigger_config ?? {}) as Record<string, unknown>,
    health_blocked: r.health_blocked as boolean,
    health_blocked_reason: r.health_blocked_reason as string | null,
    updated_at: r.updated_at as string,
    folder_id: (r as { folder_id: string | null }).folder_id ?? null,
    position: (r as { position: number }).position ?? 0,
    archived_at: (r as { archived_at: string | null }).archived_at ?? null,
  }))

  return fromWorkflows.sort((a, b) => {
    if (a.position !== b.position) return a.position - b.position
    return b.updated_at.localeCompare(a.updated_at)
  })
}
