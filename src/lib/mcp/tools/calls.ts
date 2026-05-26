// MCP read tools for Twilio human call logs.
// Table: call_logs (org_id).

import { z } from 'zod'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import type { McpToolDef } from '../tool-types'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function db() { return createServiceRoleClient() as any }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function applyCallFilters(q: any, f: { direction?: string; contact_id?: string; opportunity_id?: string }) {
  if (f.direction) q = q.eq('direction', f.direction)
  if (f.contact_id) q = q.eq('contact_id', f.contact_id)
  if (f.opportunity_id) q = q.eq('opportunity_id', f.opportunity_id)
  return q
}

export const callsTools: McpToolDef[] = [
  {
    name: 'calls_list',
    title: 'List human call logs (Twilio)',
    description: 'List human-handled calls (Twilio), newest first. Optional filters by direction, contact, opportunity.',
    area: 'general_xphere',
    inputSchema: z.object({
      direction: z.enum(['inbound', 'outbound']).optional(),
      contact_id: z.string().uuid().optional(),
      opportunity_id: z.string().uuid().optional(),
      limit: z.number().int().positive().max(100).optional(),
    }).strict(),
    handler: async (input, { auth }) => {
      const limit = input.limit ?? 30
      let q = db()
        .from('call_logs')
        .select('id, call_sid, direction, routing_mode, from_number, to_number, status, duration_seconds, contact_id, opportunity_id, created_at, phone_number_id')
        .eq('org_id', auth.orgId)
      q = applyCallFilters(q, input)
      const { data } = await q.order('created_at', { ascending: false }).limit(limit)
      return { calls: data ?? [] }
    },
  },
  {
    name: 'calls_count',
    title: 'Count human call logs',
    description: 'Returns the total number of Twilio call logs, optionally filtered.',
    area: 'general_xphere',
    inputSchema: z.object({
      direction: z.enum(['inbound', 'outbound']).optional(),
      contact_id: z.string().uuid().optional(),
      opportunity_id: z.string().uuid().optional(),
    }).strict(),
    handler: async (input, { auth }) => {
      let q = db()
        .from('call_logs')
        .select('id', { count: 'exact', head: true })
        .eq('org_id', auth.orgId)
      q = applyCallFilters(q, input)
      const { count, error } = await q
      if (error) return { error: 'count_failed', detail: error.message }
      return { count: count ?? 0 }
    },
  },
  {
    name: 'calls_get',
    title: 'Get human call log',
    description: 'Fetch one Twilio call log with full fields (recording_url included if available).',
    area: 'general_xphere',
    inputSchema: z.object({ call_id: z.string().uuid() }).strict(),
    handler: async ({ call_id }, { auth }) => {
      const { data } = await db()
        .from('call_logs')
        .select('*')
        .eq('id', call_id)
        .eq('org_id', auth.orgId)
        .maybeSingle()
      if (!data) return { error: 'not_found', status: 404 }
      return data
    },
  },
]
