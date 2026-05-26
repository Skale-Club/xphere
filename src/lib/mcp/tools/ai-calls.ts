// MCP read tools for Vapi AI calls.
// Table: `calls` (legacy column name: organization_id, not org_id).

import { z } from 'zod'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import type { McpToolDef } from '../tool-types'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function db() { return createServiceRoleClient() as any }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function applyAiCallFilters(q: any, f: { assistant_id?: string; status?: string; from?: string; to?: string }) {
  if (f.assistant_id) q = q.eq('assistant_id', f.assistant_id)
  if (f.status) q = q.eq('status', f.status)
  if (f.from) q = q.gte('started_at', f.from)
  if (f.to) q = q.lte('started_at', f.to)
  return q
}

export const aiCallsTools: McpToolDef[] = [
  {
    name: 'ai_calls_list',
    title: 'List AI (Vapi) calls',
    description: 'List recent Vapi AI call records, newest first. Optional filters: assistant, status, time range.',
    area: 'general_xphere',
    inputSchema: z.object({
      assistant_id: z.string().optional(),
      status: z.string().optional(),
      from: z.string().datetime().optional(),
      to: z.string().datetime().optional(),
      limit: z.number().int().positive().max(100).optional(),
    }).strict(),
    handler: async (input, { auth }) => {
      const limit = input.limit ?? 30
      let q = db()
        .from('calls')
        .select('id, vapi_call_id, assistant_id, call_type, status, ended_reason, started_at, ended_at, duration_seconds, cost, customer_number, customer_name, summary')
        .eq('organization_id', auth.orgId)
      q = applyAiCallFilters(q, input)
      const { data } = await q.order('started_at', { ascending: false, nullsFirst: false }).limit(limit)
      return { calls: data ?? [] }
    },
  },
  {
    name: 'ai_calls_count',
    title: 'Count AI calls',
    description: 'Returns the total number of AI calls, optionally filtered.',
    area: 'general_xphere',
    inputSchema: z.object({
      assistant_id: z.string().optional(),
      status: z.string().optional(),
      from: z.string().datetime().optional(),
      to: z.string().datetime().optional(),
    }).strict(),
    handler: async (input, { auth }) => {
      let q = db()
        .from('calls')
        .select('id', { count: 'exact', head: true })
        .eq('organization_id', auth.orgId)
      q = applyAiCallFilters(q, input)
      const { count, error } = await q
      if (error) return { error: 'count_failed', detail: error.message }
      return { count: count ?? 0 }
    },
  },
  {
    name: 'ai_calls_get',
    title: 'Get AI call with transcript',
    description: 'Fetch a single Vapi call with full transcript and turn-by-turn data.',
    area: 'general_xphere',
    inputSchema: z.object({ call_id: z.string().uuid() }).strict(),
    handler: async ({ call_id }, { auth }) => {
      const { data } = await db()
        .from('calls')
        .select('*')
        .eq('id', call_id)
        .eq('organization_id', auth.orgId)
        .maybeSingle()
      if (!data) return { error: 'not_found', status: 404 }
      return data
    },
  },
]
