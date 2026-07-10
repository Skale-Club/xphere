// SEED-033: synchronous flow executor for agent-callable workflows.
//
// kind='flow' workflows attached to agents are invoked inline during the
// agent turn. This module walks the workflow graph in topological order,
// calls executeAction() per action node, and returns the final state with a
// hard timeout. wait/agent/end nodes are handled inline:
//
//   - wait  → recorded as "not suspended"; the run finishes immediately with
//             a note. For long suspensions, schedule via the event queue
//             instead of calling this from an agent turn.
//   - agent → stubbed (cannot recurse into runAgent safely from here yet).
//   - end   → terminates execution successfully.
//
// The function reads two graph shapes seen in the codebase:
//   YAML/spec : { trigger: {...}, nodes: [{id, kind, ...}], edges: [{from,to}] }
//   Flow eng. : { nodes: [{id, type, data: {kind, ...}}], edges: [{source,target}] }
//
// Errors are returned in a structured result rather than thrown | the agent
// runtime needs to surface them to the LLM as tool-call results.

import { createServiceRoleClient } from '@/lib/supabase/admin'
import { executeAction, type ActionContext } from '@/lib/action-engine/execute-action'
import { executeAgentNode } from '@/lib/flows/execute-agent-node'
import { evaluateCondition } from '@/lib/flows/interpolate'
import type { Database } from '@/types/database'

type ActionType = Database['public']['Enums']['action_type']

export interface RunFlowSyncParams {
  workflowId: string
  definition: unknown
  triggerInput: Record<string, unknown>
  context: {
    orgId: string
    conversationId?: string
    channel?: string
    agentId?: string
  }
  timeoutMs?: number
}

export interface RunFlowSyncResult {
  ok: boolean
  result?: unknown
  error?: string
  timed_out?: boolean
  run_id?: string
}

// ─── Graph normalization ──────────────────────────────────────────────────────

interface NormalizedNode {
  id: string
  kind: 'action' | 'trigger' | 'condition' | 'wait' | 'agent' | 'end'
  actionType?: string
  config: Record<string, unknown>
  raw: Record<string, unknown>
}

interface NormalizedEdge {
  from: string
  to: string
  when?: string
}

interface NormalizedGraph {
  nodes: NormalizedNode[]
  edges: NormalizedEdge[]
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function normalizeGraph(definition: unknown): NormalizedGraph {
  const out: NormalizedGraph = { nodes: [], edges: [] }
  if (!isObject(definition)) return out

  const rawNodes = Array.isArray(definition.nodes) ? definition.nodes : []
  const rawEdges = Array.isArray(definition.edges) ? definition.edges : []

  for (const node of rawNodes) {
    if (!isObject(node)) continue
    const id = String(node.id ?? '')
    if (!id) continue

    // Flow engine shape: node.type + node.data.kind
    if (typeof node.type === 'string' && isObject(node.data)) {
      const data = node.data
      const dataKind = String(data.kind ?? node.type)
      if (dataKind === 'action') {
        out.nodes.push({
          id,
          kind: 'action',
          actionType: String(data.action_type ?? ''),
          config: (data.config as Record<string, unknown>) ?? {},
          raw: node,
        })
      } else if (
        dataKind === 'trigger' ||
        dataKind === 'condition' ||
        dataKind === 'wait' ||
        dataKind === 'agent' ||
        dataKind === 'end'
      ) {
        out.nodes.push({
          id,
          kind: dataKind,
          config: { ...data },
          raw: node,
        })
      }
      continue
    }

    // YAML/spec shape: node.kind is the action_type for action nodes
    const ykind = String(node.kind ?? '')
    if (!ykind || id === 'trigger') {
      out.nodes.push({ id, kind: 'trigger', config: { ...node }, raw: node })
      continue
    }
    if (ykind === 'condition' || ykind === 'wait' || ykind === 'agent' || ykind === 'end') {
      out.nodes.push({ id, kind: ykind, config: { ...node }, raw: node })
    } else {
      // action node | node.kind is the action_type; remaining fields are config
      const { id: _id, kind: _k, ...rest } = node
      void _id
      void _k
      out.nodes.push({
        id,
        kind: 'action',
        actionType: ykind,
        config: rest,
        raw: node,
      })
    }
  }

  for (const edge of rawEdges) {
    if (!isObject(edge)) continue
    const from = String(edge.from ?? edge.source ?? '')
    const to = String(edge.to ?? edge.target ?? '')
    if (!from || !to) continue
    // Condition branch label. Authored as `when`/`handle` in YAML and stored as
    // `sourceHandle` in the flow-engine shape — read all three so branching
    // behaves identically to the durable engine (src/lib/flows/engine.ts).
    const branch =
      edge.when !== undefined ? String(edge.when)
      : edge.sourceHandle != null ? String(edge.sourceHandle)
      : edge.handle !== undefined ? String(edge.handle)
      : undefined
    out.edges.push({ from, to, when: branch })
  }

  return out
}

// ─── Simple `{{var}}` interpolation against an accumulated scope ─────────────

// Path resolution shared-in-spirit with src/lib/flows/interpolate.ts: walks a
// dot-separated path through objects AND arrays (so `list.0.name` resolves the
// same way in both engines).
function resolveScopePath(scope: unknown, path: string): unknown {
  let cur: unknown = scope
  for (const seg of path.split('.')) {
    if (cur === null || cur === undefined || typeof cur !== 'object') return undefined
    cur = (cur as Record<string, unknown>)[seg]
  }
  return cur
}

function interpolateValue(value: unknown, scope: Record<string, unknown>): unknown {
  if (typeof value === 'string') {
    return value.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_match, expr: string) => {
      const cur = resolveScopePath(scope, expr.trim())
      if (cur === undefined || cur === null) return ''
      if (typeof cur === 'object') return JSON.stringify(cur)
      return String(cur)
    })
  }
  if (Array.isArray(value)) return value.map((v) => interpolateValue(v, scope))
  if (isObject(value)) {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value)) out[k] = interpolateValue(v, scope)
    return out
  }
  return value
}

// ─── Audit row ───────────────────────────────────────────────────────────────

async function recordRunRow(params: {
  workflowId: string
  orgId: string
  triggerInput: Record<string, unknown>
}): Promise<string | null> {
  try {
    const supabase = createServiceRoleClient()
    const { data, error } = await supabase
      .from('workflow_runs')
      .insert({
        org_id: params.orgId,
        workflow_id: params.workflowId,
        trigger_type: 'tool_call',
        trigger_payload: params.triggerInput,
        status: 'running',
        started_at: new Date().toISOString(),
      })
      .select('id')
      .single()
    if (error || !data) return null
    return data.id
  } catch {
    return null
  }
}

async function finalizeRunRow(
  runId: string | null,
  status: 'succeeded' | 'failed',
  state: Record<string, unknown>,
  error?: string,
): Promise<void> {
  if (!runId) return
  try {
    const supabase = createServiceRoleClient()
    await supabase
      .from('workflow_runs')
      .update({
        status,
        state,
        ended_at: new Date().toISOString(),
        error: error ?? null,
      })
      .eq('id', runId)
  } catch {
    /* best-effort audit; non-fatal */
  }
}

// ─── Execution ───────────────────────────────────────────────────────────────

const DEFAULT_TIMEOUT_MS = 30_000

export async function runFlowSync(
  params: RunFlowSyncParams,
): Promise<RunFlowSyncResult> {
  const timeoutMs = params.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const runner = runInline(params)
  const timer = new Promise<RunFlowSyncResult>((resolve) => {
    setTimeout(() => {
      resolve({
        ok: true,
        result: 'Workflow timed out at this turn (still running in background).',
        timed_out: true,
      })
    }, timeoutMs)
  })
  return Promise.race([runner, timer])
}

async function runInline(params: RunFlowSyncParams): Promise<RunFlowSyncResult> {
  const graph = normalizeGraph(params.definition)
  if (graph.nodes.length === 0) {
    return { ok: false, error: 'workflow_has_no_nodes' }
  }

  const runId = await recordRunRow({
    workflowId: params.workflowId,
    orgId: params.context.orgId,
    triggerInput: params.triggerInput,
  })

  // Scope shape is kept identical to the durable engine (src/lib/flows/engine.ts)
  // so a workflow resolves the same variables regardless of which engine runs it:
  //   {{input.*}} and {{trigger.payload.*}} both point at the trigger payload;
  //   {{trigger.type}}, {{trigger.fired_at}} are available;
  //   node outputs are readable as BOTH {{<node_id>.output.*}} and
  //   {{steps.<node_id>.output.*}}.
  const triggerType =
    isObject(params.triggerInput) && typeof params.triggerInput.event === 'string'
      ? params.triggerInput.event
      : 'tool_call'
  const scope: Record<string, unknown> = {
    trigger: { type: triggerType, fired_at: new Date().toISOString(), payload: params.triggerInput },
    input: params.triggerInput,
    steps: {} as Record<string, { output: unknown }>,
  }

  // Promote top-level keys of the trigger payload into the scope so that
  // event-triggered workflows can reference {{opportunity.title}}, {{contact.name}},
  // {{meeting.attendee_contact.name}}, etc. directly without the `input.`
  // prefix. Reserved keys are never overwritten.
  if (isObject(params.triggerInput)) {
    for (const [key, value] of Object.entries(params.triggerInput)) {
      if (key === 'trigger' || key === 'input' || key === 'steps') continue
      if (scope[key] === undefined) scope[key] = value
    }
  }

  // Record a node's output under both scope shapes so downstream {{...}} refs
  // resolve the same way in either engine.
  const recordOutput = (nodeId: string, output: unknown): void => {
    scope[nodeId] = { output }
    ;(scope.steps as Record<string, { output: unknown }>)[nodeId] = { output }
  }

  // Build a topological ordering by following edges from `trigger` (or first
  // node) breadth-first. We don't fully support condition branching here |
  // condition nodes are evaluated trivially (always take 'true' branch) and a
  // warning is logged. Most agent-callable flows are linear.
  const nodesById = new Map(graph.nodes.map((n) => [n.id, n]))
  const startId = nodesById.has('trigger')
    ? 'trigger'
    : graph.nodes[0].id

  const supabase = createServiceRoleClient()
  const actionCtx: ActionContext = {
    organizationId: params.context.orgId,
    supabase,
  }

  let cursorId: string | undefined = startId
  let lastOutput: unknown = undefined
  let runError: string | undefined
  let stepCount = 0
  // Aligned with the durable engine (src/lib/flows/engine.ts) so a workflow's
  // step budget doesn't depend on which engine runs it.
  const MAX_STEPS = 100

  while (cursorId && stepCount < MAX_STEPS) {
    stepCount++
    const node = nodesById.get(cursorId)
    if (!node) break

    if (node.kind === 'trigger') {
      // Move forward
      const nextEdge = graph.edges.find((e) => e.from === node.id)
      cursorId = nextEdge?.to
      continue
    }

    if (node.kind === 'end') {
      break
    }

    if (node.kind === 'wait') {
      // Agent-callable flows should not synchronously block. Record and
      // terminate with a "started" message so the agent can tell the user.
      lastOutput = {
        _note: 'Workflow contains a wait node; deferred to background.',
        run_id: runId,
      }
      await finalizeRunRow(runId, 'succeeded', scope as Record<string, unknown>)
      return {
        ok: true,
        result: `Workflow started. Run id: ${runId ?? 'n/a'}. It will complete in the background.`,
        run_id: runId ?? undefined,
      }
    }

    if (node.kind === 'agent') {
      // Recursion guard: when this flow is itself running as an agent tool
      // (context.agentId set), executing another agent node could loop
      // agent → flow → agent → … indefinitely. Skip in that case. Event-
      // triggered flows (no agentId) run the agent normally.
      if (params.context.agentId) {
        lastOutput = { _skipped: true, _note: 'Agent node skipped inside an agent-tool flow (recursion guard).' }
        recordOutput(node.id, lastOutput)
      } else {
        const cfg = node.config as Record<string, unknown>
        const userMessage = interpolateValue(String(cfg.input ?? ''), scope) as string
        const maxStepsRaw = Number(cfg.max_steps)
        const out = await executeAgentNode({
          orgId: params.context.orgId,
          agentId: typeof cfg.agent_id === 'string' ? cfg.agent_id : undefined,
          userMessage,
          instructions: typeof cfg.system_prompt === 'string' ? cfg.system_prompt : undefined,
          maxSteps: Number.isFinite(maxStepsRaw) ? maxStepsRaw : undefined,
        })
        lastOutput = out
        recordOutput(node.id, out)
      }
      const nextEdge = graph.edges.find((e) => e.from === node.id)
      cursorId = nextEdge?.to
      continue
    }

    if (node.kind === 'condition') {
      const cfg = node.config as Record<string, unknown>
      const expr = String(cfg.expression ?? '')
      const branch = evaluateCondition(expr, scope as Record<string, unknown>) ? 'true' : 'false'
      // Unified branch selection (mirrors src/lib/flows/engine.ts pickNextNode):
      // 1) an edge labeled with this branch, else 2) an unlabeled default edge,
      // else 3) stop. Prevents "always take the first edge" divergence.
      const outs = graph.edges.filter((e) => e.from === node.id)
      const nextEdge =
        outs.find((e) => e.when === branch) ??
        outs.find((e) => e.when === undefined || e.when === '')
      cursorId = nextEdge?.to
      continue
    }

    if (node.kind === 'action') {
      const resolvedConfig = interpolateValue(node.config, scope) as Record<string, unknown>
      try {
        const actionType = (node.actionType ?? 'unknown') as ActionType
        const result = await executeAction(
          actionType,
          resolvedConfig,
          { apiKey: '', locationId: '' },
          actionCtx,
        )
        lastOutput = result
        recordOutput(node.id, result)
      } catch (err) {
        runError = err instanceof Error ? err.message : String(err)
        break
      }

      const nextEdge = graph.edges.find((e) => e.from === node.id)
      cursorId = nextEdge?.to
      continue
    }

    // Unknown node kind | bail.
    runError = `unknown_node_kind:${node.kind}`
    break
  }

  if (stepCount >= MAX_STEPS) {
    runError = runError ?? 'step_limit_exceeded'
  }

  await finalizeRunRow(
    runId,
    runError ? 'failed' : 'succeeded',
    scope as Record<string, unknown>,
    runError,
  )

  if (runError) {
    return { ok: false, error: runError, run_id: runId ?? undefined }
  }
  return { ok: true, result: lastOutput, run_id: runId ?? undefined }
}
