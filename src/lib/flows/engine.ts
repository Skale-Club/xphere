// Workflow engine | Phase B v1.
// Executes a flow synchronously by walking from the trigger node along
// outgoing edges. Linear sequences fully supported. Condition nodes branch via
// edge.sourceHandle ('true' | 'false'). Wait/agent nodes record intent but
// don't suspend execution (long-running suspension lands when pgmq/pg_cron
// ship in a follow-up).

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import type { FlowDefinition, FlowEdge, FlowNode } from './schema'
import { FlowDefinition as FlowDefinitionSchema } from './schema'
import { interpolate, evaluateCondition } from './interpolate'
import { executeNode, type ExecutorContext } from './executors'
import { insertNotification } from '@/lib/notifications/insert'

const MAX_STEPS = 100 // hard cap to prevent runaway loops in v1

export interface RunInput {
  workflowId: string
  versionId: string | null
  definition: FlowDefinition
  orgId: string
  triggerType?: string
  triggerPayload?: Record<string, unknown>
  createdBy?: string | null
  supabase: SupabaseClient<Database>
}

export interface RunResult {
  runId: string
  status: 'succeeded' | 'failed'
  error?: string
}

export async function runFlow(input: RunInput): Promise<RunResult> {
  const parsed = FlowDefinitionSchema.safeParse(input.definition)
  if (!parsed.success) {
    return { runId: '', status: 'failed', error: parsed.error.issues[0]?.message ?? 'invalid_definition' }
  }
  const def = parsed.data

  // ── Create run row ──────────────────────────────────────────────────────────
  const { data: runRow, error: runErr } = await input.supabase
    .from('workflow_runs')
    .insert({
      org_id: input.orgId,
      workflow_id: input.workflowId,
      workflow_version_id: input.versionId,
      trigger_type: input.triggerType ?? 'manual',
      trigger_payload: input.triggerPayload ?? {},
      status: 'running',
      started_at: new Date().toISOString(),
      created_by: input.createdBy ?? null,
    })
    .select()
    .single()

  if (runErr || !runRow) {
    return { runId: '', status: 'failed', error: runErr?.message ?? 'run_create_failed' }
  }

  // ── Walk the graph ──────────────────────────────────────────────────────────
  const state: Record<string, unknown> = {
    trigger: { type: input.triggerType ?? 'manual', payload: input.triggerPayload ?? {} },
    steps: {} as Record<string, { output: Record<string, unknown> }>,
  }

  const nodesById = new Map(def.nodes.map((n) => [n.id, n]))
  const trigger = def.nodes.find((n) => n.type === 'trigger')

  if (!trigger) {
    await finalizeRun(input.supabase, runRow.id, 'failed', state, 'no_trigger_node')
    return { runId: runRow.id, status: 'failed', error: 'no_trigger_node' }
  }

  const ctx: ExecutorContext = { orgId: input.orgId, supabase: input.supabase, state }

  let current: FlowNode | undefined = trigger
  let stepCount = 0
  let runError: string | undefined

  while (current && stepCount < MAX_STEPS) {
    const node: FlowNode = current
    stepCount++
    const stepId = `${node.id}_${stepCount}`

    // Record step start
    await input.supabase.from('workflow_run_steps').insert({
      run_id: runRow.id,
      step_id: stepId,
      node_id: node.id,
      node_type: node.type,
      status: 'running',
      input: extractNodeConfig(node) as unknown as Record<string, unknown>,
      started_at: new Date().toISOString(),
    })

    // Resolve config with state interpolation
    const rawConfig = extractNodeConfig(node)
    const resolvedConfig = interpolate(rawConfig, state) as Record<string, unknown>

    // Execute
    let output: Record<string, unknown> = {}
    let stepError: string | undefined
    try {
      const result = await executeNode(node, resolvedConfig, ctx)
      output = result.output
    } catch (err) {
      stepError = err instanceof Error ? err.message : String(err)
    }

    // Record step end
    await input.supabase
      .from('workflow_run_steps')
      .update({
        status: stepError ? 'failed' : 'succeeded',
        output,
        error: stepError ?? null,
        ended_at: new Date().toISOString(),
      })
      .eq('run_id', runRow.id)
      .eq('step_id', stepId)

    if (stepError) {
      runError = stepError
      break
    }

    // Persist output into state
    ;(state.steps as Record<string, { output: Record<string, unknown> }>)[node.id] = { output }

    // Terminate at end node
    if (node.type === 'end') break

    // Pick next edge
    const next = pickNextNode(node, output, def.edges, nodesById, state)
    current = next
  }

  if (stepCount >= MAX_STEPS) {
    runError = `step_limit_exceeded (${MAX_STEPS})`
  }

  await finalizeRun(input.supabase, runRow.id, runError ? 'failed' : 'succeeded', state, runError)

  if (runError) {
    void insertNotification(input.orgId, 'flow_failed', {
      workflow_id: input.workflowId,
      workflow_run_id: runRow.id,
      error: runError,
    })
  }

  return { runId: runRow.id, status: runError ? 'failed' : 'succeeded', error: runError }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function extractNodeConfig(node: FlowNode): Record<string, unknown> {
  const data = node.data
  if (data.kind === 'action') return data.config ?? {}
  if (data.kind === 'trigger') return (data.filter ?? {}) as Record<string, unknown>
  if (data.kind === 'condition') return { expression: data.expression }
  if (data.kind === 'wait') {
    return { mode: data.mode, duration: data.duration, event_filter: data.event_filter, timeout: data.timeout }
  }
  if (data.kind === 'agent') {
    return { agent_id: data.agent_id, system_prompt: data.system_prompt, max_steps: data.max_steps }
  }
  return {}
}

function pickNextNode(
  current: FlowNode,
  output: Record<string, unknown>,
  edges: FlowEdge[],
  nodesById: Map<string, FlowNode>,
  state: Record<string, unknown>,
): FlowNode | undefined {
  // Condition node: pick edge by sourceHandle ('true'/'false')
  if (current.data.kind === 'condition') {
    const branch = evaluateCondition(current.data.expression, state) ? 'true' : 'false'
    const edge = edges.find((e) => e.source === current.id && (e.sourceHandle ?? 'true') === branch)
      ?? edges.find((e) => e.source === current.id)
    return edge ? nodesById.get(edge.target) : undefined
  }

  // Default: take first outgoing edge (linear-first)
  const edge = edges.find((e) => e.source === current.id)
  void output
  return edge ? nodesById.get(edge.target) : undefined
}

async function finalizeRun(
  supabase: SupabaseClient<Database>,
  runId: string,
  status: 'succeeded' | 'failed',
  state: Record<string, unknown>,
  error?: string,
): Promise<void> {
  await supabase
    .from('workflow_runs')
    .update({
      status,
      state,
      ended_at: new Date().toISOString(),
      error: error ?? null,
    })
    .eq('id', runId)
}
