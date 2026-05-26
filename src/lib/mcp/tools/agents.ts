// MCP read tools for AI agents.
// Table: agents (organization_id — legacy column).

import { z } from 'zod'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import type { McpToolDef } from '../tool-types'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function db() { return createServiceRoleClient() as any }

export const agentsTools: McpToolDef[] = [
  {
    name: 'agents_list',
    title: 'List agents',
    description: 'List AI agents in the current org. Optional active filter.',
    area: 'general_xphere',
    inputSchema: z.object({
      active_only: z.boolean().optional(),
    }).strict(),
    handler: async ({ active_only }, { auth }) => {
      let q = db()
        .from('agents')
        .select('id, name, slug, description, model, is_active, allowed_channels, max_history, temperature, created_at, updated_at')
        .eq('organization_id', auth.orgId)
        .order('updated_at', { ascending: false })
      if (active_only) q = q.eq('is_active', true)
      const { data } = await q
      return { agents: data ?? [] }
    },
  },
  {
    name: 'agents_get',
    title: 'Get agent with channel defaults',
    description: 'Fetch one agent including system_prompt and the org\'s channel-default mapping (which channels route to this agent).',
    area: 'general_xphere',
    inputSchema: z.object({ agent_id: z.string().uuid() }).strict(),
    handler: async ({ agent_id }, { auth }) => {
      const supabase = db()
      const { data: agent } = await supabase
        .from('agents')
        .select('*')
        .eq('id', agent_id)
        .eq('organization_id', auth.orgId)
        .maybeSingle()
      if (!agent) return { error: 'not_found', status: 404 }

      const { data: channelDefaults } = await supabase
        .from('agent_channel_defaults')
        .select('channel, is_default')
        .eq('agent_id', agent_id)
        .eq('organization_id', auth.orgId)

      return { ...agent, channel_defaults: channelDefaults ?? [] }
    },
  },
]
