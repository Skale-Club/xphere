// MCP read tools for sales pipelines and their stages.
// Needed so the agent can resolve stage_ids before calling opportunities_move_stage
// or opportunities_create.

import { z } from 'zod'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import type { McpToolDef } from '../tool-types'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function db() { return createServiceRoleClient() as any }

export const pipelinesTools: McpToolDef[] = [
  {
    name: 'pipelines_list',
    title: 'List pipelines',
    description: 'List all sales pipelines in the current org, ordered by position.',
    area: 'general_xphere',
    inputSchema: z.object({}).strict(),
    handler: async (_input, { auth }) => {
      const { data } = await db()
        .from('pipelines')
        .select('id, name, is_default, position, card_fields, created_at')
        .eq('org_id', auth.orgId)
        .order('position', { ascending: true })
      return { pipelines: data ?? [] }
    },
  },
  {
    name: 'pipelines_get',
    title: 'Get pipeline',
    description: 'Fetch a single pipeline by id.',
    area: 'general_xphere',
    inputSchema: z.object({ pipeline_id: z.string().uuid() }).strict(),
    handler: async ({ pipeline_id }, { auth }) => {
      const { data } = await db()
        .from('pipelines')
        .select('*')
        .eq('id', pipeline_id)
        .eq('org_id', auth.orgId)
        .maybeSingle()
      if (!data) return { error: 'not_found', status: 404 }
      return data
    },
  },
  {
    name: 'pipeline_stages_list',
    title: 'List pipeline stages',
    description: 'List stages within a pipeline (or all stages across all pipelines if pipeline_id is omitted).',
    area: 'general_xphere',
    inputSchema: z.object({ pipeline_id: z.string().uuid().optional() }).strict(),
    handler: async ({ pipeline_id }, { auth }) => {
      let q = db()
        .from('pipeline_stages')
        .select('id, pipeline_id, name, position, color, is_won, is_lost')
        .eq('org_id', auth.orgId)
      if (pipeline_id) q = q.eq('pipeline_id', pipeline_id)
      const { data } = await q.order('position', { ascending: true })
      return { stages: data ?? [] }
    },
  },
  {
    name: 'pipelines_get_default',
    title: 'Get the default pipeline and its stages',
    description: 'Returns the org\'s default pipeline together with its stages — the typical starting point for creating a new opportunity.',
    area: 'general_xphere',
    inputSchema: z.object({}).strict(),
    handler: async (_input, { auth }) => {
      const supabase = db()
      // Prefer is_default=true; otherwise the first pipeline by position.
      const { data: defaultRow } = await supabase
        .from('pipelines')
        .select('*')
        .eq('org_id', auth.orgId)
        .eq('is_default', true)
        .maybeSingle()
      let pipeline = defaultRow
      if (!pipeline) {
        const { data: firstRow } = await supabase
          .from('pipelines')
          .select('*')
          .eq('org_id', auth.orgId)
          .order('position', { ascending: true })
          .limit(1)
          .maybeSingle()
        pipeline = firstRow
      }
      if (!pipeline) return { error: 'not_found', detail: 'no pipelines defined in this org', status: 404 }

      const { data: stages } = await supabase
        .from('pipeline_stages')
        .select('id, name, position, color, is_won, is_lost')
        .eq('pipeline_id', pipeline.id)
        .eq('org_id', auth.orgId)
        .order('position', { ascending: true })

      return { pipeline, stages: stages ?? [] }
    },
  },
]
