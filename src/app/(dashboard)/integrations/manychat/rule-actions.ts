'use server'

import { createClient, getUser } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import type { Database, Json } from '@/types/database'

type ManychatRuleRow = Database['public']['Tables']['manychat_rules']['Row']

export interface ManychatRuleInput {
  channelId: string
  eventType: string
  condition: Record<string, unknown>
  toolConfigId: string
  priority?: number
  isActive?: boolean
}

/**
 * Create a routing rule.
 *
 * org_id is NOT set manually | RLS `WITH CHECK (org_id = get_current_org_id())`
 * populates it from the active org cookie. This matches the channel-actions
 * pattern (Phase 22 locked decision).
 *
 * Priority semantics: ASC (lower number wins). Default 0.
 */
export async function createManychatRule(
  data: ManychatRuleInput
): Promise<{ error?: string } | void> {
  const user = await getUser()
  if (!user) return { error: 'Not authenticated.' }

  const supabase = await createClient()

  const { error } = await supabase.from('manychat_rules').insert({
    channel_id: data.channelId,
    event_type: data.eventType,
    condition: data.condition as Json,
    tool_config_id: data.toolConfigId,
    priority: data.priority ?? 0,
    is_active: data.isActive ?? true,
    // org_id intentionally omitted | RLS WITH CHECK populates it
  })

  if (error) return { error: error.message }

  revalidatePath('/integrations/manychat')
  revalidatePath('/integrations/manychat/rules')
}

/**
 * Update a routing rule. Only fields explicitly provided are patched |
 * undefined fields are excluded from the UPDATE statement.
 */
export async function updateManychatRule(
  id: string,
  data: Partial<ManychatRuleInput>
): Promise<{ error?: string } | void> {
  const user = await getUser()
  if (!user) return { error: 'Not authenticated.' }

  const supabase = await createClient()

  const update: Database['public']['Tables']['manychat_rules']['Update'] = {}
  if (data.channelId !== undefined) update.channel_id = data.channelId
  if (data.eventType !== undefined) update.event_type = data.eventType
  if (data.condition !== undefined) update.condition = data.condition as Json
  if (data.toolConfigId !== undefined) update.tool_config_id = data.toolConfigId
  if (data.priority !== undefined) update.priority = data.priority
  if (data.isActive !== undefined) update.is_active = data.isActive

  const { error } = await supabase
    .from('manychat_rules')
    .update(update)
    .eq('id', id)

  if (error) return { error: error.message }

  revalidatePath('/integrations/manychat')
  revalidatePath('/integrations/manychat/rules')
}

/**
 * Delete a routing rule.
 *
 * Note: tool_config_id has ON DELETE RESTRICT | deleting the bound tool_config
 * is blocked while a rule references it. The Phase 26 UI must surface this as
 * a "this tool is bound to N rules" warning before allowing tool deletion.
 */
export async function deleteManychatRule(
  id: string
): Promise<{ error?: string } | void> {
  const user = await getUser()
  if (!user) return { error: 'Not authenticated.' }

  const supabase = await createClient()

  const { error } = await supabase
    .from('manychat_rules')
    .delete()
    .eq('id', id)

  if (error) return { error: error.message }

  revalidatePath('/integrations/manychat')
  revalidatePath('/integrations/manychat/rules')
}

/**
 * List all rules for the active org, sorted by priority ASC.
 * RLS handles org scoping | no manual filter needed.
 *
 * Used by Phase 26 UI (rules list page) and as a sanity helper for tests.
 */
export async function getManychatRules(): Promise<ManychatRuleRow[]> {
  const user = await getUser()
  if (!user) return []

  const supabase = await createClient()

  const { data, error } = await supabase
    .from('manychat_rules')
    .select('*')
    .order('priority', { ascending: true })

  if (error || !data) return []
  return data as ManychatRuleRow[]
}
