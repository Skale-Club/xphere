// MCP read tools for custom field definitions.
// Lets the agent discover non-standard fields before issuing updates that
// touch the custom_fields JSONB column on contacts/accounts/opportunities.

import { z } from 'zod'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import type { McpToolDef } from '../tool-types'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function db() { return createServiceRoleClient() as any }

export const customFieldsTools: McpToolDef[] = [
  {
    name: 'custom_fields_list',
    title: 'List custom field definitions',
    description: 'List custom field definitions for a given entity type (contact, account, or opportunity).',
    area: 'general_xphere',
    inputSchema: z.object({
      entity: z.enum(['contact', 'account', 'opportunity']),
      include_archived: z.boolean().optional(),
    }).strict(),
    handler: async ({ entity, include_archived }, { auth }) => {
      let q = db()
        .from('custom_field_definitions')
        .select('id, entity, key, label, type, required, unique_per_org, position, group_name, help_text, options, archived')
        .eq('org_id', auth.orgId)
        .eq('entity', entity)
      if (!include_archived) q = q.eq('archived', false)
      const { data } = await q.order('position', { ascending: true })
      return { fields: data ?? [] }
    },
  },
  {
    name: 'custom_fields_get',
    title: 'Get custom field definition',
    description: 'Fetch a single custom field definition by id.',
    area: 'general_xphere',
    inputSchema: z.object({ field_id: z.string().uuid() }).strict(),
    handler: async ({ field_id }, { auth }) => {
      const { data } = await db()
        .from('custom_field_definitions')
        .select('*')
        .eq('id', field_id)
        .eq('org_id', auth.orgId)
        .maybeSingle()
      if (!data) return { error: 'not_found', status: 404 }
      return data
    },
  },
]
