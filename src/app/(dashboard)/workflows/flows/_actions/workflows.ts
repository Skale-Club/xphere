'use server'

import { z } from 'zod'
import { createClient, getUser } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import type { Database } from '@/types/database'
import { FlowDefinition, emptyFlowDefinition } from '@/lib/flows/schema'

type ActionResult<T = void> = { ok: true; data: T } | { ok: false; error: string }

export type WorkflowRow = Database['public']['Tables']['workflows']['Row']
export type WorkflowVersionRow = Database['public']['Tables']['workflow_versions']['Row']

// ─── List ─────────────────────────────────────────────────────────────────────

export async function listWorkflows(): Promise<ActionResult<WorkflowRow[]>> {
  const user = await getUser()
  if (!user) return { ok: false, error: 'not_authenticated' }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('workflows')
    .select('*')
    .order('updated_at', { ascending: false })

  if (error) return { ok: false, error: error.message }
  return { ok: true, data: data ?? [] }
}

// ─── Get (header + current version) ───────────────────────────────────────────

export type WorkflowWithVersion = WorkflowRow & {
  currentVersion: WorkflowVersionRow | null
  definition: FlowDefinition
}

export async function getWorkflow(id: string): Promise<ActionResult<WorkflowWithVersion>> {
  const user = await getUser()
  if (!user) return { ok: false, error: 'not_authenticated' }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('workflows')
    .select('*')
    .eq('id', id)
    .single()

  if (error || !data) return { ok: false, error: error?.message ?? 'not_found' }

  let currentVersion: WorkflowVersionRow | null = null
  let definition = emptyFlowDefinition()

  if (data.current_version_id) {
    const { data: ver } = await supabase
      .from('workflow_versions')
      .select('*')
      .eq('id', data.current_version_id)
      .single()
    if (ver) {
      currentVersion = ver
      const parsed = FlowDefinition.safeParse(ver.definition)
      if (parsed.success) definition = parsed.data
    }
  }

  return { ok: true, data: { ...data, currentVersion, definition } }
}

// ─── Create ───────────────────────────────────────────────────────────────────

const createSchema = z.object({
  name: z.string().min(1).max(120),
  slug: z.string().min(1).max(80).regex(/^[a-z0-9-]+$/, 'slug must be lowercase with dashes only'),
  description: z.string().max(2000).optional(),
})

export type WorkflowCreateInput = z.infer<typeof createSchema>

export async function createWorkflow(
  input: WorkflowCreateInput,
): Promise<ActionResult<WorkflowRow>> {
  const user = await getUser()
  if (!user) return { ok: false, error: 'not_authenticated' }

  const parsed = createSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'validation_error' }

  const supabase = await createClient()
  const { data: orgId } = await supabase.rpc('get_current_org_id')
  if (!orgId) return { ok: false, error: 'no_active_org' }

  // Resolve unique slug | if base slug is taken, try base_1, base_2, ...
  let slug = parsed.data.slug
  const { data: existing } = await supabase
    .from('workflows')
    .select('slug')
    .ilike('slug', `${slug}%`)
  const takenSlugs = new Set((existing ?? []).map((r) => r.slug))
  if (takenSlugs.has(slug)) {
    let n = 1
    while (takenSlugs.has(`${slug}_${n}`)) n++
    slug = `${slug}_${n}`
  }

  // Create header
  const { data: workflow, error: wErr } = await supabase
    .from('workflows')
    .insert({
      org_id: orgId as string,
      name: parsed.data.name,
      slug,
      description: parsed.data.description ?? null,
      created_by: user.id,
    })
    .select()
    .single()

  if (wErr || !workflow) return { ok: false, error: wErr?.message ?? 'create_failed' }

  // Create initial empty version
  const { data: version, error: vErr } = await supabase
    .from('workflow_versions')
    .insert({
      workflow_id: workflow.id,
      version_number: 1,
      definition: emptyFlowDefinition() as unknown as Record<string, unknown>,
      created_by: user.id,
    })
    .select()
    .single()

  if (vErr || !version) {
    await supabase.from('workflows').delete().eq('id', workflow.id)
    return { ok: false, error: vErr?.message ?? 'version_create_failed' }
  }

  // Wire current_version_id
  await supabase
    .from('workflows')
    .update({ current_version_id: version.id })
    .eq('id', workflow.id)

  revalidatePath('/workflows/flows')
  return { ok: true, data: { ...workflow, current_version_id: version.id } }
}

// ─── Save definition (creates new version) ────────────────────────────────────

export async function saveWorkflowDefinition(
  workflowId: string,
  definition: FlowDefinition,
  options: { notes?: string; createNewVersion?: boolean } = {},
): Promise<ActionResult<{ versionId: string; versionNumber: number }>> {
  const user = await getUser()
  if (!user) return { ok: false, error: 'not_authenticated' }

  const parsed = FlowDefinition.safeParse(definition)
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'invalid_definition' }

  const supabase = await createClient()

  // Strategy: overwrite current version on autosave (createNewVersion=false),
  // or bump to a new version on explicit save (createNewVersion=true).
  if (!options.createNewVersion) {
    const { data: workflow } = await supabase
      .from('workflows')
      .select('current_version_id')
      .eq('id', workflowId)
      .single()

    if (workflow?.current_version_id) {
      const { error } = await supabase
        .from('workflow_versions')
        .update({ definition: parsed.data as unknown as Record<string, unknown> })
        .eq('id', workflow.current_version_id)

      if (error) return { ok: false, error: error.message }

      const { data: ver } = await supabase
        .from('workflow_versions')
        .select('id, version_number')
        .eq('id', workflow.current_version_id)
        .single()

      // Bump updated_at on header
      await supabase.from('workflows').update({ updated_at: new Date().toISOString() }).eq('id', workflowId)

      return { ok: true, data: { versionId: ver?.id ?? '', versionNumber: ver?.version_number ?? 1 } }
    }
  }

  // New version path
  const { data: latest } = await supabase
    .from('workflow_versions')
    .select('version_number')
    .eq('workflow_id', workflowId)
    .order('version_number', { ascending: false })
    .limit(1)
    .single()

  const nextVersionNumber = (latest?.version_number ?? 0) + 1

  const { data: version, error: vErr } = await supabase
    .from('workflow_versions')
    .insert({
      workflow_id: workflowId,
      version_number: nextVersionNumber,
      definition: parsed.data as unknown as Record<string, unknown>,
      notes: options.notes ?? null,
      created_by: user.id,
    })
    .select()
    .single()

  if (vErr || !version) return { ok: false, error: vErr?.message ?? 'save_failed' }

  await supabase
    .from('workflows')
    .update({ current_version_id: version.id })
    .eq('id', workflowId)

  revalidatePath(`/workflows/flows/${workflowId}`)
  return { ok: true, data: { versionId: version.id, versionNumber: version.version_number } }
}

// ─── Update header ────────────────────────────────────────────────────────────

const updateSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  description: z.string().max(2000).nullable().optional(),
  is_active: z.boolean().optional(),
})

export async function updateWorkflow(
  id: string,
  input: z.infer<typeof updateSchema>,
): Promise<ActionResult<WorkflowRow>> {
  const user = await getUser()
  if (!user) return { ok: false, error: 'not_authenticated' }

  const parsed = updateSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'validation_error' }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('workflows')
    .update(parsed.data)
    .eq('id', id)
    .select()
    .single()

  if (error || !data) return { ok: false, error: error?.message ?? 'not_found' }
  revalidatePath('/workflows/flows')
  revalidatePath(`/workflows/flows/${id}`)
  return { ok: true, data }
}

// ─── Toggle active ────────────────────────────────────────────────────────────

export async function toggleWorkflowActive(
  id: string,
  active: boolean,
): Promise<ActionResult<void>> {
  const user = await getUser()
  if (!user) return { ok: false, error: 'not_authenticated' }

  const supabase = await createClient()

  // Try workflows table first; fall back to legacy tool_configs for unbackfilled rows.
  const { data: wf, error: wfErr } = await supabase
    .from('workflows')
    .update({ is_active: active })
    .eq('id', id)
    .select('id')
    .single()

  if (!wfErr && wf) {
    revalidatePath('/workflows')
    revalidatePath(`/workflows/flows/${id}`)
    return { ok: true, data: undefined }
  }

  const { error: tcErr } = await supabase
    .from('tool_configs')
    .update({ is_active: active })
    .eq('id', id)

  if (tcErr) return { ok: false, error: tcErr.message }

  revalidatePath('/workflows')
  return { ok: true, data: undefined }
}

// ─── Delete ───────────────────────────────────────────────────────────────────

export async function deleteWorkflow(id: string): Promise<ActionResult<void>> {
  const user = await getUser()
  if (!user) return { ok: false, error: 'not_authenticated' }

  const supabase = await createClient()
  const { error } = await supabase.from('workflows').delete().eq('id', id)

  if (error) return { ok: false, error: error.message }
  revalidatePath('/workflows/flows')
  return { ok: true, data: undefined }
}
