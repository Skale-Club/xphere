// MCP tools for the Opportunities / Pipeline module.

import { z } from 'zod'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import type { McpToolDef } from '../tool-types'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function db() { return createServiceRoleClient() as any }

export const opportunitiesTools: McpToolDef[] = [
  {
    name: 'opportunities_list',
    title: 'List opportunities',
    description: 'List opportunities in the current org. Optionally filter by pipeline, stage or status.',
    area: 'general_xphere',
    inputSchema: z.object({
      pipeline_id: z.string().uuid().optional(),
      stage_id: z.string().uuid().optional(),
      status: z.enum(['open', 'won', 'lost']).optional(),
      limit: z.number().int().positive().max(200).optional(),
    }).strict(),
    handler: async ({ pipeline_id, stage_id, status, limit = 50 }, { auth }) => {
      let q = db()
        .from('opportunities')
        .select('id, title, value, currency, status, pipeline_id, stage_id, contact_id, account_id, expected_close_date, updated_at')
        .eq('org_id', auth.orgId)
        .order('updated_at', { ascending: false })
        .limit(limit)
      if (pipeline_id) q = q.eq('pipeline_id', pipeline_id)
      if (stage_id) q = q.eq('stage_id', stage_id)
      if (status) q = q.eq('status', status)
      const { data } = await q
      return { opportunities: data ?? [] }
    },
  },
  {
    name: 'opportunities_get',
    title: 'Get opportunity',
    description: 'Fetch a single opportunity by id.',
    area: 'general_xphere',
    inputSchema: z.object({ opportunity_id: z.string().uuid() }).strict(),
    handler: async ({ opportunity_id }, { auth }) => {
      const { data } = await db()
        .from('opportunities')
        .select('*')
        .eq('id', opportunity_id)
        .eq('org_id', auth.orgId)
        .maybeSingle()
      if (!data) return { error: 'not_found', status: 404 }
      return data
    },
  },
  {
    name: 'opportunities_create',
    title: 'Create opportunity',
    description: 'Create a new opportunity. Required: pipeline_id, stage_id, title.',
    area: 'general_xphere',
    inputSchema: z.object({
      pipeline_id: z.string().uuid(),
      stage_id: z.string().uuid(),
      title: z.string().min(1),
      contact_id: z.string().uuid().optional(),
      account_id: z.string().uuid().optional(),
      value: z.number().nonnegative().optional(),
      currency: z.string().length(3).optional(),
      expected_close_date: z.string().optional(),
      assigned_to: z.string().uuid().optional(),
    }).strict(),
    handler: async (input, { auth }) => {
      const { data, error } = await db()
        .from('opportunities')
        .insert({
          org_id: auth.orgId,
          pipeline_id: input.pipeline_id,
          stage_id: input.stage_id,
          title: input.title,
          contact_id: input.contact_id ?? null,
          account_id: input.account_id ?? null,
          value: input.value ?? 0,
          currency: input.currency ?? 'USD',
          status: 'open',
          expected_close_date: input.expected_close_date ?? null,
          assigned_to: input.assigned_to ?? null,
        })
        .select()
        .single()
      if (error) return { error: 'insert_failed', detail: error.message }
      return data
    },
  },
  {
    name: 'opportunities_update',
    title: 'Update opportunity',
    description: 'Patch opportunity fields. Only supplied fields are changed.',
    area: 'general_xphere',
    inputSchema: z.object({
      opportunity_id: z.string().uuid(),
      title: z.string().optional(),
      value: z.number().nonnegative().optional(),
      currency: z.string().length(3).optional(),
      status: z.enum(['open', 'won', 'lost']).optional(),
      expected_close_date: z.string().nullable().optional(),
      assigned_to: z.string().uuid().nullable().optional(),
    }).strict(),
    handler: async (input, { auth }) => {
      const { opportunity_id, ...patch } = input
      if (Object.keys(patch).length === 0) {
        return { error: 'no_fields', detail: 'no fields to update' }
      }
      const { error } = await db()
        .from('opportunities')
        .update(patch)
        .eq('id', opportunity_id)
        .eq('org_id', auth.orgId)
      if (error) return { error: 'update_failed', detail: error.message }
      return { updated: true }
    },
  },
  {
    name: 'opportunities_move_stage',
    title: 'Move opportunity to a new stage',
    description: 'Move an opportunity to a different pipeline stage.',
    area: 'general_xphere',
    inputSchema: z.object({
      opportunity_id: z.string().uuid(),
      stage_id: z.string().uuid(),
    }).strict(),
    handler: async ({ opportunity_id, stage_id }, { auth }) => {
      const { error } = await db()
        .from('opportunities')
        .update({ stage_id })
        .eq('id', opportunity_id)
        .eq('org_id', auth.orgId)
      if (error) return { error: 'update_failed', detail: error.message }
      return { moved: true, stage_id }
    },
  },
]
