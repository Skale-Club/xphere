// SEED-033: dispatcher for agent-invoked workflow tools.
//
// kind='tool' workflows are 1-action graphs | delegate straight to the action
// engine using the action node's kind/action_type and its declared config
// merged with the LLM-provided input.
//
// kind='flow' workflows are multi-step DAGs | delegate to runFlowSync with a
// 30s timeout. The result is returned to the LLM as the tool-call output.

import { createServiceRoleClient } from '@/lib/supabase/admin'
import { executeAction, type ActionContext } from '@/lib/action-engine/execute-action'
import { extractActionTypeFromDefinition } from '@/lib/workflows/derive-action-type'
import { runFlowSync } from '@/lib/workflows/run-flow-sync'
import { runFlow, definitionHasWait } from '@/lib/flows/engine'
import type { FlowDefinition } from '@/lib/flows/schema'
import type { Database } from '@/types/database'

type ActionType = Database['public']['Enums']['action_type']

export interface WorkflowToolResult {
  ok: boolean
  result?: unknown
  error?: string
  timed_out?: boolean
  run_id?: string
}

export interface ExecuteWorkflowToolParams {
  workflowId: string
  kind: 'tool' | 'flow'
  definition: unknown
  input: Record<string, unknown>
  context: {
    orgId: string
    conversationId?: string
    channel?: string
    agentId?: string
  }
  timeoutMs?: number
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

// Pull the single non-trigger action node's config out of either shape.
function extractActionConfig(definition: unknown): Record<string, unknown> {
  if (!isObject(definition)) return {}
  const nodes = Array.isArray(definition.nodes) ? definition.nodes : []
  for (const node of nodes) {
    if (!isObject(node)) continue
    // Flow engine shape
    if (typeof node.type === 'string' && isObject(node.data)) {
      const data = node.data
      if (data.kind === 'action') {
        return isObject(data.config) ? (data.config as Record<string, unknown>) : {}
      }
    }
    // YAML/spec shape
    if (typeof node.kind === 'string' && node.id !== 'trigger') {
      const { id: _id, kind: _k, ...rest } = node
      void _id
      void _k
      return rest as Record<string, unknown>
    }
  }
  return {}
}

export async function executeWorkflowTool(
  params: ExecuteWorkflowToolParams,
): Promise<WorkflowToolResult> {
  if (params.kind === 'tool') {
    const actionType = extractActionTypeFromDefinition(params.definition) as ActionType
    if (!actionType || actionType === ('unknown' as unknown as ActionType)) {
      return { ok: false, error: 'workflow_has_no_action_node' }
    }

    const baseConfig = extractActionConfig(params.definition)
    // LLM-supplied input wins over declared defaults so the agent can
    // override interpolated placeholders by passing concrete values.
    const merged: Record<string, unknown> = { ...baseConfig, ...params.input }

    const supabase = createServiceRoleClient()
    const ctx: ActionContext = {
      organizationId: params.context.orgId,
      supabase,
    }

    try {
      const result = await executeAction(
        actionType,
        merged,
        { apiKey: '', locationId: '' },
        ctx,
      )
      return { ok: true, result }
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      }
    }
  }

  if (params.kind === 'flow') {
    // Flows with a wait node must suspend on the persistent engine so post-wait
    // nodes actually run later — the sync runner would silently drop them and
    // report success. Resume needs the version id, so look it up.
    if (definitionHasWait(params.definition)) {
      const supabase = createServiceRoleClient()
      const { data: wf } = await supabase
        .from('workflows')
        .select('current_version_id')
        .eq('id', params.workflowId)
        .maybeSingle()
      const result = await runFlow({
        workflowId: params.workflowId,
        versionId: wf?.current_version_id ?? null,
        definition: params.definition as FlowDefinition,
        orgId: params.context.orgId,
        triggerType: 'tool_call',
        triggerPayload: params.input,
        supabase,
      })
      if (result.status === 'waiting') {
        return {
          ok: true,
          result: `Workflow started. Run id: ${result.runId}. It will continue in the background when the awaited event or timeout occurs.`,
          run_id: result.runId,
        }
      }
      return {
        ok: result.status !== 'failed',
        result: `Workflow ${result.status}. Run id: ${result.runId}.`,
        error: result.error,
        run_id: result.runId,
      }
    }
    return runFlowSync({
      workflowId: params.workflowId,
      definition: params.definition,
      triggerInput: params.input,
      context: params.context,
      timeoutMs: params.timeoutMs ?? 30_000,
    })
  }

  return { ok: false, error: `unsupported_workflow_kind:${String(params.kind)}` }
}
