'use server'

import { createClient, getUser } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import type { Database } from '@/types/database'
import { runFlow } from '@/lib/flows/engine'
import { FlowDefinition } from '@/lib/flows/schema'

type ActionResult<T = void> = { ok: true; data: T } | { ok: false; error: string }

export type RunRow = Database['public']['Tables']['workflow_runs']['Row']
export type RunStepRow = Database['public']['Tables']['workflow_run_steps']['Row']

// ─── List runs for a workflow ─────────────────────────────────────────────────

export async function listWorkflowRuns(
  workflowId: string,
  limit = 50,
): Promise<ActionResult<RunRow[]>> {
  const user = await getUser()
  if (!user) return { ok: false, error: 'not_authenticated' }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('workflow_runs')
    .select('*')
    .eq('workflow_id', workflowId)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) return { ok: false, error: error.message }
  return { ok: true, data: data ?? [] }
}

// ─── Get one run with steps ──────────────────────────────────────────────────

export type RunWithSteps = RunRow & { steps: RunStepRow[] }

export async function getWorkflowRun(runId: string): Promise<ActionResult<RunWithSteps>> {
  const user = await getUser()
  if (!user) return { ok: false, error: 'not_authenticated' }

  const supabase = await createClient()
  const { data: run, error } = await supabase
    .from('workflow_runs')
    .select('*')
    .eq('id', runId)
    .single()

  if (error || !run) return { ok: false, error: error?.message ?? 'not_found' }

  const { data: steps } = await supabase
    .from('workflow_run_steps')
    .select('*')
    .eq('run_id', runId)
    .order('created_at', { ascending: true })

  return { ok: true, data: { ...run, steps: steps ?? [] } }
}

// ─── Run flow now (synchronous execution) ────────────────────────────────────

export async function runFlowNow(input: {
  workflowId: string
  triggerPayload?: Record<string, unknown>
}): Promise<ActionResult<{ runId: string; status: string }>> {
  const user = await getUser()
  if (!user) return { ok: false, error: 'not_authenticated' }

  const supabase = await createClient()

  // Resolve workflow + current definition
  const { data: workflow } = await supabase
    .from('workflows')
    .select('id, org_id, current_version_id')
    .eq('id', input.workflowId)
    .single()

  if (!workflow) return { ok: false, error: 'workflow_not_found' }

  if (!workflow.current_version_id) {
    return { ok: false, error: 'no_version_to_run' }
  }

  const { data: version } = await supabase
    .from('workflow_versions')
    .select('id, definition')
    .eq('id', workflow.current_version_id)
    .single()

  if (!version) return { ok: false, error: 'version_not_found' }

  const parsed = FlowDefinition.safeParse(version.definition)
  if (!parsed.success) return { ok: false, error: 'invalid_definition' }

  // Execute (synchronous | Vercel Fluid Compute handles long bursts up to 800s)
  const result = await runFlow({
    workflowId: workflow.id,
    versionId: version.id,
    definition: parsed.data,
    orgId: workflow.org_id,
    triggerType: 'manual',
    triggerPayload: input.triggerPayload ?? {},
    createdBy: user.id,
    supabase,
  })

  if (!result.runId) return { ok: false, error: result.error ?? 'run_failed' }

  revalidatePath(`/automations/flows/${input.workflowId}`)
  return { ok: true, data: { runId: result.runId, status: result.status } }
}
