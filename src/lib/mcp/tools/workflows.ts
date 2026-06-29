// MCP tools for workflows.
// Workflows can be listed, inspected and manually triggered. Manual trigger
// inserts a row in `workflow_runs` with status='queued' | the runtime worker
// picks it up (same pattern used by the Copilot run_workflow tool).

import { z } from 'zod'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import type { McpToolDef } from '../tool-types'

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
      'Enqueue a manual run of a workflow. Returns { run_id, status } | the worker picks the row up async. The workflow must be active and not health-blocked.',
    area: 'general_xphere',
    inputSchema: z.object({
      workflow_id: z.string().uuid(),
      payload: z.record(z.unknown()).optional(),
    }).strict(),
    handler: async ({ workflow_id, payload }, { auth }) => {
      const supabase = db()
      const { data: workflow } = await supabase
        .from('workflows')
        .select('id, name, is_active, health_blocked')
        .eq('id', workflow_id)
        .eq('org_id', auth.orgId)
        .maybeSingle()
      if (!workflow) return { error: 'not_found', status: 404 }
      if (!workflow.is_active) return { error: 'inactive', detail: 'workflow is not active' }
      if (workflow.health_blocked) return { error: 'health_blocked', detail: 'workflow is health-blocked' }

      const { data: run, error } = await supabase
        .from('workflow_runs')
        .insert({
          org_id: auth.orgId,
          workflow_id,
          trigger_type: 'manual',
          trigger_payload: payload ?? {},
          status: 'queued',
          created_by: auth.userId ?? null,
        })
        .select('id, status, created_at')
        .single()
      if (error) return { error: 'enqueue_failed', detail: error.message }
      return {
        run_id: run.id,
        status: run.status,
        workflow_id,
        workflow_name: workflow.name,
        created_at: run.created_at,
      }
    },
  },
]
