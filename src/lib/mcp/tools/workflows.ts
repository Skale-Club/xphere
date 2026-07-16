// MCP tools for workflows.
// Workflows can be listed, inspected and manually triggered. Manual trigger
// executes the workflow inline (same engine used by the dashboard "Run now"
// button and real event triggers) and returns once the run settles.

import { z } from 'zod'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import type { McpToolDef } from '../tool-types'
import { runFlow } from '@/lib/flows/engine'
import { FlowDefinition } from '@/lib/flows/schema'
import { executeWorkflowTool } from '@/lib/agent-runtime/execute-workflow-tool'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function db() { return createServiceRoleClient() as any }

export const workflowsTools: McpToolDef[] = [
  {
    name: 'workflows_list',
    title: 'List workflows',
    description: 'List workflows in the current org. Optional filters: active only, kind (tool | flow).',
    area: 'general_xphere',
    inputSchema: z.object({
      active_only: z.boolean().optional(),
      kind: z.enum(['tool', 'flow']).optional(),
    }).strict(),
    handler: async ({ active_only, kind }, { auth }) => {
      let q = db()
        .from('workflows')
        .select('id, name, slug, description, is_active, kind, tool_name, trigger_type, health_blocked, health_blocked_reason, created_at, updated_at')
        .eq('org_id', auth.orgId)
        .order('updated_at', { ascending: false })
      if (active_only) q = q.eq('is_active', true)
      if (kind) q = q.eq('kind', kind)
      const { data } = await q
      return { workflows: data ?? [] }
    },
  },
  {
    name: 'workflows_get',
    title: 'Get workflow with current version',
    description: 'Fetch one workflow including its current version definition (node DAG, trigger config). Useful before triggering or explaining a workflow.',
    area: 'general_xphere',
    inputSchema: z.object({ workflow_id: z.string().uuid() }).strict(),
    handler: async ({ workflow_id }, { auth }) => {
      const supabase = db()
      const { data: workflow } = await supabase
        .from('workflows')
        .select('*')
        .eq('id', workflow_id)
        .eq('org_id', auth.orgId)
        .maybeSingle()
      if (!workflow) return { error: 'not_found', status: 404 }

      let version: Record<string, unknown> | null = null
      if (workflow.current_version_id) {
        const { data: v } = await supabase
          .from('workflow_versions')
          .select('id, version_number, definition, created_at')
          .eq('id', workflow.current_version_id)
          .maybeSingle()
        version = v ?? null
      }
      return { ...workflow, current_version: version }
    },
  },
  {
    name: 'workflows_trigger',
    title: 'Manually trigger a workflow run',
    description:
      'Manually run a workflow now (kind=flow runs the full node DAG, kind=tool executes its single action). Executes inline and returns the settled run status. The workflow must be active and not health-blocked.',
    area: 'general_xphere',
    inputSchema: z.object({
      workflow_id: z.string().uuid(),
      payload: z.record(z.unknown()).optional(),
    }).strict(),
    handler: async ({ workflow_id, payload }, { auth }) => {
      const supabase = db()
      const { data: workflow } = await supabase
        .from('workflows')
        .select('id, name, kind, is_active, health_blocked, current_version_id')
        .eq('id', workflow_id)
        .eq('org_id', auth.orgId)
        .maybeSingle()
      if (!workflow) return { error: 'not_found', status: 404 }
      if (!workflow.is_active) return { error: 'inactive', detail: 'workflow is not active' }
      if (workflow.health_blocked) return { error: 'health_blocked', detail: 'workflow is health-blocked' }
      if (!workflow.current_version_id) {
        return { error: 'no_version_to_run', detail: 'workflow has no published version' }
      }

      const { data: version } = await supabase
        .from('workflow_versions')
        .select('id, definition')
        .eq('id', workflow.current_version_id)
        .maybeSingle()
      if (!version) return { error: 'version_not_found' }

      if (workflow.kind === 'tool') {
        const result = await executeWorkflowTool({
          workflowId: workflow.id,
          kind: 'tool',
          definition: version.definition,
          input: payload ?? {},
          context: { orgId: auth.orgId },
          toolName: workflow.name,
          triggerType: 'mcp',
        })
        return {
          status: result.ok ? 'succeeded' : 'failed',
          workflow_id,
          workflow_name: workflow.name,
          result: result.result,
          error: result.error,
        }
      }

      const parsed = FlowDefinition.safeParse(version.definition)
      if (!parsed.success) {
        return { error: 'invalid_definition', detail: parsed.error.issues[0]?.message ?? 'invalid definition' }
      }

      const result = await runFlow({
        workflowId: workflow.id,
        versionId: version.id,
        definition: parsed.data,
        orgId: auth.orgId,
        triggerType: 'manual',
        triggerPayload: payload ?? {},
        createdBy: auth.userId ?? null,
        supabase,
      })

      return {
        run_id: result.runId,
        status: result.status,
        workflow_id,
        workflow_name: workflow.name,
        error: result.error,
      }
    },
  },
]
