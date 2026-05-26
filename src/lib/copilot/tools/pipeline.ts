// Pipeline / opportunity tools.

import type { CopilotToolRegistry, ToolContext, ToolResult } from './types'

const MAX_ROWS = 50

async function queryOpportunities(input: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const status = input.status as 'open' | 'won' | 'lost' | undefined
  const stageId = input.stage_id as string | undefined
  const search = input.search as string | undefined
  const limit = Math.min(Number(input.limit ?? 25), MAX_ROWS)

  let query = ctx.supabase
    .from('opportunities')
    .select('id, title, value, currency, status, stage_id, contact_id, expected_close_date, created_at')
    .order('created_at', { ascending: false })
    .limit(limit)

  if (status) query = query.eq('status', status)
  if (stageId) query = query.eq('stage_id', stageId)
  if (search && search.trim()) query = query.ilike('title', `%${search.trim()}%`)

  const { data, error } = await query
  if (error) return { success: false, error: error.message }
  return { success: true, data: { opportunities: data, count: data?.length ?? 0 } }
}

async function getOpportunity(input: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const id = input.id as string
  if (!id) return { success: false, error: 'id required' }
  const { data, error } = await ctx.supabase
    .from('opportunities').select('*').eq('id', id).maybeSingle()
  if (error) return { success: false, error: error.message }
  if (!data) return { success: false, error: `opportunity ${id} not found` }
  return { success: true, data }
}

async function createOpportunity(input: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const title = input.title as string | undefined
  const pipelineId = input.pipeline_id as string | undefined
  const stageId = input.stage_id as string | undefined
  if (!title || !pipelineId || !stageId) {
    return { success: false, error: 'title, pipeline_id, stage_id required' }
  }
  const { data, error } = await ctx.supabase
    .from('opportunities')
    .insert({
      org_id: ctx.orgId,
      title,
      pipeline_id: pipelineId,
      stage_id: stageId,
      // TODO Phase 110: wrap with resolveLiveContactId
      contact_id: (input.contact_id as string | undefined) ?? null,
      value: Number(input.value ?? 0),
      currency: (input.currency as string | undefined) ?? 'USD',
      created_by: ctx.userId,
    })
    .select('id, title, value, status')
    .single()
  if (error) return { success: false, error: error.message }
  return { success: true, data }
}

async function updateOpportunity(input: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const id = input.id as string
  if (!id) return { success: false, error: 'id required' }
  const patch: Record<string, unknown> = {}
  for (const k of ['title', 'value', 'currency', 'status', 'expected_close_date']) {
    if (input[k] !== undefined) patch[k] = input[k]
  }
  if (Object.keys(patch).length === 0) return { success: false, error: 'no fields to update' }
  const { data, error } = await ctx.supabase
    .from('opportunities').update(patch).eq('id', id)
    .select('id, title, value, status').maybeSingle()
  if (error) return { success: false, error: error.message }
  if (!data) return { success: false, error: `opportunity ${id} not found` }
  return { success: true, data }
}

async function moveToStage(input: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const id = input.opportunity_id as string
  const stageId = input.stage_id as string
  if (!id || !stageId) return { success: false, error: 'opportunity_id and stage_id required' }
  const { data, error } = await ctx.supabase
    .from('opportunities').update({ stage_id: stageId }).eq('id', id)
    .select('id, stage_id').maybeSingle()
  if (error) return { success: false, error: error.message }
  if (!data) return { success: false, error: `opportunity ${id} not found` }
  return { success: true, data }
}

async function listPipelines(_input: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const { data: pipelines, error: pipErr } = await ctx.supabase
    .from('pipelines')
    .select('id, name, is_default, position')
    .order('position')
  if (pipErr) return { success: false, error: pipErr.message }

  const { data: stages, error: stgErr } = await ctx.supabase
    .from('pipeline_stages')
    .select('id, pipeline_id, name, position, is_won, is_lost')
    .order('position')
  if (stgErr) return { success: false, error: stgErr.message }

  return { success: true, data: { pipelines, stages } }
}

async function summarizePipelineHealth(_input: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const { data, error } = await ctx.supabase
    .from('opportunities')
    .select('stage_id, status, value, currency')
    .eq('status', 'open')
  if (error) return { success: false, error: error.message }

  const byStage: Record<string, { count: number; totalValue: number }> = {}
  for (const row of data ?? []) {
    const k = row.stage_id ?? 'unknown'
    if (!byStage[k]) byStage[k] = { count: 0, totalValue: 0 }
    byStage[k].count += 1
    byStage[k].totalValue += Number(row.value ?? 0)
  }
  return {
    success: true,
    data: {
      total_open: data?.length ?? 0,
      total_value: (data ?? []).reduce((acc, r) => acc + Number(r.value ?? 0), 0),
      by_stage: byStage,
    },
  }
}

export const pipelineTools: CopilotToolRegistry = {
  query_opportunities: {
    mode: 'read',
    definition: {
      name: 'query_opportunities',
      description: 'Search opportunities (deals) by title, filter by status (open|won|lost) or stage. Up to 50.',
      input_schema: {
        type: 'object',
        properties: {
          search: { type: 'string' },
          status: { type: 'string', enum: ['open', 'won', 'lost'] },
          stage_id: { type: 'string' },
          limit: { type: 'number' },
        },
      },
    },
    handler: queryOpportunities,
  },
  get_opportunity: {
    mode: 'read',
    definition: {
      name: 'get_opportunity',
      description: 'Fetch a single opportunity by id.',
      input_schema: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
      },
    },
    handler: getOpportunity,
  },
  create_opportunity: {
    mode: 'write',
    definition: {
      name: 'create_opportunity',
      description: 'Create a new opportunity. Requires title, pipeline_id, stage_id. Optionally contact_id and value.',
      input_schema: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          pipeline_id: { type: 'string' },
          stage_id: { type: 'string' },
          contact_id: { type: 'string' },
          value: { type: 'number' },
          currency: { type: 'string' },
        },
        required: ['title', 'pipeline_id', 'stage_id'],
      },
    },
    handler: createOpportunity,
  },
  update_opportunity: {
    mode: 'write',
    definition: {
      name: 'update_opportunity',
      description: 'Patch an opportunity (title, value, status, etc.).',
      input_schema: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          title: { type: 'string' },
          value: { type: 'number' },
          currency: { type: 'string' },
          status: { type: 'string', enum: ['open', 'won', 'lost'] },
          expected_close_date: { type: 'string', description: 'YYYY-MM-DD' },
        },
        required: ['id'],
      },
    },
    handler: updateOpportunity,
  },
  move_to_stage: {
    mode: 'write',
    definition: {
      name: 'move_to_stage',
      description: 'Move an opportunity to a different stage. Call list_pipelines first to learn stage ids.',
      input_schema: {
        type: 'object',
        properties: {
          opportunity_id: { type: 'string' },
          stage_id: { type: 'string' },
        },
        required: ['opportunity_id', 'stage_id'],
      },
    },
    handler: moveToStage,
  },
  list_pipelines: {
    mode: 'read',
    definition: {
      name: 'list_pipelines',
      description: 'List all pipelines + their stages (ordered).',
      input_schema: { type: 'object', properties: {} },
    },
    handler: listPipelines,
  },
  summarize_pipeline_health: {
    mode: 'read',
    definition: {
      name: 'summarize_pipeline_health',
      description: 'Aggregate open opportunities by stage with counts + total value.',
      input_schema: { type: 'object', properties: {} },
    },
    handler: summarizePipelineHealth,
  },
}
