// Workflow tools | list, get, create, update, validate, run, explain, delete, capabilities.

import type { CopilotToolRegistry, ToolContext, ToolResult } from './types'
import { validateWorkflow, type WorkflowDefinition } from '@/lib/workflows/validate'
import { getWorkflowSpec } from '@/lib/workflows/spec'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

// ─── Handlers ─────────────────────────────────────────────────────────────────

async function listWorkflows(
  input: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const kind = input.kind as 'tool' | 'flow' | undefined

  let query = ctx.supabase
    .from('workflows')
    .select('id, name, slug, description, kind, trigger_type, is_active, health_blocked, health_blocked_reason, updated_at')
    .order('updated_at', { ascending: false })

  if (kind) query = query.eq('kind', kind)

  const { data, error } = await query
  if (error) return { success: false, error: error.message }
  return { success: true, data: { workflows: data, count: data?.length ?? 0 } }
}

async function getWorkflow(
  input: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const id = input.id as string | undefined
  if (!id) return { success: false, error: 'id required' }

  const { data: workflow, error: wErr } = await ctx.supabase
    .from('workflows')
    .select('*')
    .eq('id', id)
    .maybeSingle()

  if (wErr) return { success: false, error: wErr.message }
  if (!workflow) return { success: false, error: `workflow ${id} not found` }

  // Fetch current version definition if available
  let definition: Record<string, unknown> | null = null
  if (workflow.current_version_id) {
    const { data: version } = await ctx.supabase
      .from('workflow_versions')
      .select('id, version_number, definition, notes, created_at')
      .eq('id', workflow.current_version_id)
      .maybeSingle()
    if (version) definition = version as unknown as Record<string, unknown>
  }

  return { success: true, data: { ...workflow, current_version: definition } }
}

async function createWorkflow(
  input: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const definition = input.definition as WorkflowDefinition | undefined
  if (!definition) return { success: false, error: 'definition required' }

  const name = (definition.name as string | undefined) ?? (input.name as string | undefined)
  if (!name) return { success: false, error: 'definition.name required' }

  // Validate against org spec first
  const spec = await getWorkflowSpec(ctx.orgId, ctx.supabase)
  const validation = validateWorkflow(definition, spec)
  if (!validation.ok) {
    return {
      success: false,
      error: 'Validation failed',
      data: { validation_errors: validation.errors },
    }
  }

  const trigger = definition.trigger
  const triggerType = trigger?.type === 'event'
    ? 'event'
    : (trigger?.type as 'tool_call' | 'event' | 'schedule' | 'manual' | 'webhook_url' | undefined) ?? 'manual'

  // Determine kind: if trigger is tool_call and there's exactly 1 node → tool; otherwise flow
  const kind: 'tool' | 'flow' =
    (input.kind as 'tool' | 'flow' | undefined) ??
    (triggerType === 'tool_call' && (definition.nodes ?? []).length === 1 ? 'tool' : 'flow')

  const slug = slugify(name)

  // Insert workflow row
  const { data: workflow, error: wErr } = await ctx.supabase
    .from('workflows')
    .insert({
      org_id: ctx.orgId,
      name,
      slug,
      description: (definition.description as string | undefined) ?? null,
      kind,
      trigger_type: triggerType,
      trigger_config: (trigger?.config ?? {}) as Record<string, unknown>,
      is_active: true,
      created_by: ctx.userId,
    })
    .select('id, name, slug, kind, trigger_type, is_active')
    .single()

  if (wErr) return { success: false, error: wErr.message }

  // Get max version number for this workflow (should be 0 since just created)
  const { data: version, error: vErr } = await ctx.supabase
    .from('workflow_versions')
    .insert({
      workflow_id: workflow.id as string,
      version_number: 1,
      definition: definition as unknown as Record<string, unknown>,
      created_by: ctx.userId,
    })
    .select('id, version_number')
    .single()

  if (vErr) return { success: false, error: vErr.message }

  // Update workflow to point to this version
  await ctx.supabase
    .from('workflows')
    .update({ current_version_id: version.id as string })
    .eq('id', workflow.id as string)

  return {
    success: true,
    data: {
      ...workflow,
      current_version_id: version.id,
      version_number: version.version_number,
    },
  }
}

async function updateWorkflow(
  input: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const id = input.id as string | undefined
  if (!id) return { success: false, error: 'id required' }

  const definition = input.definition as WorkflowDefinition | undefined
  if (!definition) return { success: false, error: 'definition required' }

  // Check workflow exists
  const { data: existing, error: fetchErr } = await ctx.supabase
    .from('workflows')
    .select('id, name, kind, current_version_id')
    .eq('id', id)
    .maybeSingle()

  if (fetchErr) return { success: false, error: fetchErr.message }
  if (!existing) return { success: false, error: `workflow ${id} not found` }

  // Validate against org spec
  const spec = await getWorkflowSpec(ctx.orgId, ctx.supabase)
  const validation = validateWorkflow(definition, spec)
  if (!validation.ok) {
    return {
      success: false,
      error: 'Validation failed',
      data: { validation_errors: validation.errors },
    }
  }

  // Determine next version number
  const { data: lastVersionRow } = await ctx.supabase
    .from('workflow_versions')
    .select('version_number')
    .eq('workflow_id', id)
    .order('version_number', { ascending: false })
    .limit(1)
    .maybeSingle()

  const nextVersion = ((lastVersionRow?.version_number as number | undefined) ?? 0) + 1

  const { data: version, error: vErr } = await ctx.supabase
    .from('workflow_versions')
    .insert({
      workflow_id: id,
      version_number: nextVersion,
      definition: definition as unknown as Record<string, unknown>,
      notes: (input.notes as string | undefined) ?? null,
      created_by: ctx.userId,
    })
    .select('id, version_number')
    .single()

  if (vErr) return { success: false, error: vErr.message }

  // Build workflow patch
  const patch: Record<string, unknown> = { current_version_id: version.id }
  if (definition.name) patch.name = definition.name
  if (definition.description !== undefined) patch.description = definition.description
  if (definition.trigger?.type) {
    patch.trigger_type = definition.trigger.type
    patch.trigger_config = definition.trigger.config ?? {}
  }

  const { data: updated, error: uErr } = await ctx.supabase
    .from('workflows')
    .update(patch)
    .eq('id', id)
    .select('id, name, slug, kind, trigger_type, is_active, current_version_id')
    .maybeSingle()

  if (uErr) return { success: false, error: uErr.message }

  return {
    success: true,
    data: { ...updated, new_version: version.version_number },
  }
}

async function validateWorkflowTool(
  input: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const definition = input.definition as WorkflowDefinition | undefined
  if (!definition) return { success: false, error: 'definition required' }

  const spec = await getWorkflowSpec(ctx.orgId, ctx.supabase)
  const result = validateWorkflow(definition, spec)

  return {
    success: true,
    data: {
      valid: result.ok,
      error_count: result.errors.length,
      errors: result.errors,
    },
  }
}

async function runWorkflow(
  input: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const id = input.id as string | undefined
  if (!id) return { success: false, error: 'id required' }

  // Confirm workflow exists
  const { data: workflow, error: fetchErr } = await ctx.supabase
    .from('workflows')
    .select('id, name, is_active, health_blocked')
    .eq('id', id)
    .maybeSingle()

  if (fetchErr) return { success: false, error: fetchErr.message }
  if (!workflow) return { success: false, error: `workflow ${id} not found` }
  if (!workflow.is_active) return { success: false, error: 'workflow is not active' }
  if (workflow.health_blocked) return { success: false, error: 'workflow is health-blocked' }

  const triggerPayload = (input.payload as Record<string, unknown> | undefined) ?? {}

  // Insert a workflow_runs row with status 'pending' | the runtime will pick it up.
  const { data: run, error: runErr } = await ctx.supabase
    .from('workflow_runs')
    .insert({
      org_id: ctx.orgId,
      workflow_id: id,
      trigger_type: 'manual',
      trigger_payload: triggerPayload,
      status: 'pending',
      created_by: ctx.userId,
    })
    .select('id, status, created_at')
    .single()

  if (runErr) return { success: false, error: runErr.message }

  return {
    success: true,
    data: {
      run_id: run.id,
      status: run.status,
      workflow_id: id,
      workflow_name: workflow.name,
    },
  }
}

async function explainWorkflow(
  input: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const id = input.id as string | undefined
  if (!id) return { success: false, error: 'id required' }

  const { data: workflow, error: wErr } = await ctx.supabase
    .from('workflows')
    .select('id, name, slug, description, kind, trigger_type, trigger_config, is_active, health_blocked, health_blocked_reason, current_version_id')
    .eq('id', id)
    .maybeSingle()

  if (wErr) return { success: false, error: wErr.message }
  if (!workflow) return { success: false, error: `workflow ${id} not found` }

  let definition: Record<string, unknown> | null = null
  if (workflow.current_version_id) {
    const { data: version } = await ctx.supabase
      .from('workflow_versions')
      .select('definition, version_number')
      .eq('id', workflow.current_version_id as string)
      .maybeSingle()
    if (version) definition = version.definition as Record<string, unknown>
  }

  const nodes = (definition?.nodes as Array<{ id: string; kind: string; [k: string]: unknown }> | undefined) ?? []
  const edges = (definition?.edges as Array<{ from: string; to: string }> | undefined) ?? []

  const nodeDescriptions = nodes.map((n) => {
    const parts: string[] = [`  - [${n.id}] kind="${n.kind}"`]
    if (n.integration) parts.push(`integration="${String(n.integration)}"`)
    return parts.join(' ')
  })

  const summary = [
    `**${workflow.name as string}** (id: ${workflow.id as string})`,
    workflow.description ? `Description: ${workflow.description as string}` : null,
    `Kind: ${workflow.kind as string} | Trigger: ${workflow.trigger_type as string}`,
    `Status: ${workflow.is_active ? 'active' : 'inactive'}${workflow.health_blocked ? ' | HEALTH BLOCKED' : ''}`,
    workflow.health_blocked_reason
      ? `Health block reason: ${workflow.health_blocked_reason as string}`
      : null,
    '',
    nodes.length > 0
      ? `Nodes (${nodes.length}):\n${nodeDescriptions.join('\n')}`
      : 'No nodes defined.',
    edges.length > 0
      ? `Edges: ${edges.map((e) => `${e.from} → ${e.to}`).join(', ')}`
      : 'No edges defined.',
  ]
    .filter((line) => line !== null)
    .join('\n')

  return {
    success: true,
    data: {
      summary,
      workflow_id: workflow.id,
      name: workflow.name,
      kind: workflow.kind,
      trigger_type: workflow.trigger_type,
      is_active: workflow.is_active,
      node_count: nodes.length,
      edge_count: edges.length,
    },
  }
}

async function deleteWorkflow(
  input: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const id = input.id as string | undefined
  if (!id) return { success: false, error: 'id required' }
  if (input.confirm_token !== 'CONFIRM') {
    return {
      success: false,
      error: 'destructive op requires confirm_token = "CONFIRM" (ask the user first)',
    }
  }

  const { data, error } = await ctx.supabase
    .from('workflows')
    .update({ is_active: false })
    .eq('id', id)
    .select('id, name, is_active')
    .maybeSingle()

  if (error) return { success: false, error: error.message }
  if (!data) return { success: false, error: `workflow ${id} not found` }

  return { success: true, data: { deactivated: id, name: data.name } }
}

async function listCapabilities(
  _input: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const spec = await getWorkflowSpec(ctx.orgId, ctx.supabase)
  return { success: true, data: spec }
}

// ─── Registry ─────────────────────────────────────────────────────────────────

export const workflowTools: CopilotToolRegistry = {
  list_workflows: {
    mode: 'read',
    definition: {
      name: 'list_workflows',
      description:
        'List workflows for this org with name, description, kind, and status. Optionally filter by kind.',
      input_schema: {
        type: 'object',
        properties: {
          kind: {
            type: 'string',
            enum: ['tool', 'flow'],
            description: 'Filter to only "tool" or "flow" workflows.',
          },
        },
      },
    },
    handler: listWorkflows,
  },

  get_workflow: {
    mode: 'read',
    definition: {
      name: 'get_workflow',
      description:
        'Get full workflow details including the current version definition (YAML/JSON nodes, edges, trigger).',
      input_schema: {
        type: 'object',
        properties: { id: { type: 'string', description: 'Workflow UUID' } },
        required: ['id'],
      },
    },
    handler: getWorkflow,
  },

  create_workflow: {
    mode: 'write',
    definition: {
      name: 'create_workflow',
      description:
        'Create a new workflow from a definition object. The definition is validated against the org spec before saving. ' +
        'Use list_capabilities first to discover available triggers and node types.',
      input_schema: {
        type: 'object',
        properties: {
          definition: {
            type: 'object',
            description:
              'Workflow definition with name, description, trigger, nodes[], and edges[]. ' +
              'Pass as a parsed JSON/YAML object.',
          },
          kind: {
            type: 'string',
            enum: ['tool', 'flow'],
            description: 'Override kind detection (default: inferred from trigger + node count).',
          },
        },
        required: ['definition'],
      },
    },
    handler: createWorkflow,
  },

  update_workflow: {
    mode: 'write',
    definition: {
      name: 'update_workflow',
      description:
        'Update an existing workflow by creating a new version. The definition is validated before saving. ' +
        'Returns the updated workflow and new version number.',
      input_schema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Workflow UUID to update' },
          definition: {
            type: 'object',
            description: 'Updated workflow definition (full replacement, not partial patch).',
          },
          notes: { type: 'string', description: 'Optional change notes for this version.' },
        },
        required: ['id', 'definition'],
      },
    },
    handler: updateWorkflow,
  },

  validate_workflow: {
    mode: 'read',
    definition: {
      name: 'validate_workflow',
      description:
        'Dry-run validate a workflow definition against the org-filtered spec. Returns structured errors ' +
        'with suggestion fields that tell you exactly how to fix each issue. Call this before create_workflow.',
      input_schema: {
        type: 'object',
        properties: {
          definition: {
            type: 'object',
            description: 'Workflow definition to validate (does not save anything).',
          },
        },
        required: ['definition'],
      },
    },
    handler: validateWorkflowTool,
  },

  run_workflow: {
    mode: 'write',
    definition: {
      name: 'run_workflow',
      description:
        'Manually trigger a workflow run. Returns run_id and initial status. ' +
        'The workflow must be active and not health-blocked.',
      input_schema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Workflow UUID to run' },
          payload: {
            type: 'object',
            description: 'Optional trigger payload (available as input.* in the workflow).',
          },
        },
        required: ['id'],
      },
    },
    handler: runWorkflow,
  },

  explain_workflow: {
    mode: 'read',
    definition: {
      name: 'explain_workflow',
      description:
        'Return a human-readable summary of what a workflow does: its trigger, nodes, edges, and health status.',
      input_schema: {
        type: 'object',
        properties: { id: { type: 'string', description: 'Workflow UUID' } },
        required: ['id'],
      },
    },
    handler: explainWorkflow,
  },

  delete_workflow: {
    mode: 'destructive',
    definition: {
      name: 'delete_workflow',
      description:
        'Deactivate a workflow (sets is_active=false). The workflow is not hard-deleted and can be reactivated. ' +
        'Requires confirm_token = "CONFIRM" | ask the user before calling.',
      input_schema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Workflow UUID to deactivate' },
          confirm_token: { type: 'string', description: 'Must equal "CONFIRM"' },
        },
        required: ['id', 'confirm_token'],
      },
    },
    handler: deleteWorkflow,
  },

  list_capabilities: {
    mode: 'read',
    definition: {
      name: 'list_capabilities',
      description:
        'Return the org-filtered workflow capability spec: available trigger types, node kinds, ' +
        'connected integrations, and variable namespaces. Always call this before authoring a new workflow.',
      input_schema: {
        type: 'object',
        properties: {},
      },
    },
    handler: listCapabilities,
  },
}
