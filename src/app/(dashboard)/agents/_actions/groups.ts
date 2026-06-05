'use server'

// Agent groups (folders) for the Agents sub-sidebar tree.
//
// CRUD for the `agent_groups` table. All actions are org-scoped via RLS | the
// active org resolves through `get_current_org_id()`, so we never filter by
// org_id manually. Mirrors `projects/_actions/spaces.ts`.

import { revalidatePath } from 'next/cache'
import { createClient, getUser } from '@/lib/supabase/server'
import type { AgentGroupRow } from '@/types/database'

// Type-cast helper: `agent_groups` isn't in the generated Database type, so we
// cast via `any` and let each function's return type guarantee correctness.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function db(supabase: Awaited<ReturnType<typeof createClient>>): any {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return supabase as any
}

type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string }

// ─── List ─────────────────────────────────────────────────────────────────────

export async function listAgentGroups(): Promise<ActionResult<AgentGroupRow[]>> {
  const user = await getUser()
  if (!user) return { ok: false, error: 'not_authenticated' }

  const supabase = await createClient()
  const { data, error } = await db(supabase)
    .from('agent_groups')
    .select('*')
    .order('position', { ascending: true })
    .order('created_at', { ascending: true })

  if (error) return { ok: false, error: error.message }
  return { ok: true, data: (data ?? []) as AgentGroupRow[] }
}

// ─── Create ───────────────────────────────────────────────────────────────────

export async function createAgentGroup(input: {
  name: string
  color?: string | null
  icon?: string | null
  parent_id?: string | null
}): Promise<ActionResult<AgentGroupRow>> {
  const user = await getUser()
  if (!user) return { ok: false, error: 'not_authenticated' }

  const name = input.name.trim()
  if (!name) return { ok: false, error: 'name_required' }

  const supabase = await createClient()
  const { data: orgId } = await supabase.rpc('get_current_org_id')
  if (!orgId) return { ok: false, error: 'no_active_org' }

  // Pick next position within siblings.
  const { data: siblings } = await db(supabase)
    .from('agent_groups')
    .select('position')
    .eq('parent_id', input.parent_id ?? (null as unknown as string))
    .order('position', { ascending: false })
    .limit(1)

  const nextPosition = (siblings?.[0]?.position ?? -1) + 1

  const { data, error } = await db(supabase)
    .from('agent_groups')
    .insert({
      org_id: orgId as string,
      name,
      color: input.color ?? null,
      icon: input.icon ?? null,
      parent_id: input.parent_id ?? null,
      position: nextPosition,
      created_by: user.id,
    })
    .select()
    .single()

  if (error || !data) {
    if (error?.code === '23505') {
      return { ok: false, error: 'A group with this name already exists here.' }
    }
    return { ok: false, error: error?.message ?? 'create_failed' }
  }

  revalidatePath('/agents')
  return { ok: true, data: data as AgentGroupRow }
}

// ─── Rename ───────────────────────────────────────────────────────────────────

export async function renameAgentGroup(
  id: string,
  input: { name: string },
): Promise<ActionResult<void>> {
  const user = await getUser()
  if (!user) return { ok: false, error: 'not_authenticated' }

  const name = input.name.trim()
  if (!name) return { ok: false, error: 'name_required' }

  const supabase = await createClient()
  const { error } = await db(supabase)
    .from('agent_groups')
    .update({ name })
    .eq('id', id)

  if (error) {
    if (error.code === '23505') {
      return { ok: false, error: 'A group with this name already exists here.' }
    }
    return { ok: false, error: error.message }
  }

  revalidatePath('/agents')
  return { ok: true, data: undefined }
}

// ─── Update meta (color / icon) ───────────────────────────────────────────────

export async function updateAgentGroupMeta(
  id: string,
  input: { color?: string | null; icon?: string | null },
): Promise<ActionResult<void>> {
  const user = await getUser()
  if (!user) return { ok: false, error: 'not_authenticated' }

  const supabase = await createClient()
  const patch: Record<string, unknown> = {}
  if (input.color !== undefined) patch.color = input.color
  if (input.icon !== undefined) patch.icon = input.icon
  if (Object.keys(patch).length === 0) return { ok: true, data: undefined }

  const { error } = await db(supabase)
    .from('agent_groups')
    .update(patch)
    .eq('id', id)

  if (error) return { ok: false, error: error.message }
  revalidatePath('/agents')
  return { ok: true, data: undefined }
}

// ─── Reorder groups (siblings) ────────────────────────────────────────────────

export async function reorderAgentGroups(
  orderedIds: string[],
): Promise<ActionResult<void>> {
  const user = await getUser()
  if (!user) return { ok: false, error: 'not_authenticated' }
  if (orderedIds.length === 0) return { ok: true, data: undefined }

  const supabase = await createClient()
  const updates = orderedIds.map((id, index) =>
    db(supabase).from('agent_groups').update({ position: index }).eq('id', id),
  )
  const results = await Promise.all(updates)
  const failed = results.find((r: { error: unknown }) => r.error)
  if (failed) return { ok: false, error: 'Failed to save group order.' }

  revalidatePath('/agents')
  return { ok: true, data: undefined }
}

// ─── Delete group ─────────────────────────────────────────────────────────────
//
// Hard-deletes the group row(s). Agents inside are UNFILED automatically by the
// `agents.group_id` FK (ON DELETE SET NULL) — they fall back to "Unfiled" and
// stay active. This DIVERGES from Projects/Workflows (which soft-delete their
// contained items): agents have no trash, and deleting a group must never lose
// or deactivate an agent. Nested sub-groups are removed via ON DELETE CASCADE.

export async function deleteAgentGroup(
  id: string,
  opts: { cascadeChildren?: boolean } = {},
): Promise<ActionResult<void>> {
  const user = await getUser()
  if (!user) return { ok: false, error: 'not_authenticated' }

  const supabase = await createClient()

  const { data: childRows } = await db(supabase)
    .from('agent_groups')
    .select('id')
    .eq('parent_id', id)
    .limit(1)

  if ((childRows ?? []).length > 0 && !opts.cascadeChildren) {
    return { ok: false, error: 'group_has_children' }
  }

  // Hard-delete the group; ON DELETE CASCADE removes nested groups and
  // ON DELETE SET NULL unfiles the agents (they stay active).
  const { error } = await db(supabase)
    .from('agent_groups')
    .delete()
    .eq('id', id)

  if (error) return { ok: false, error: error.message }

  revalidatePath('/agents')
  return { ok: true, data: undefined }
}
