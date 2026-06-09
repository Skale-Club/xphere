import { z } from 'zod'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import type { McpToolDef } from '../tool-types'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function db() { return createServiceRoleClient() as any }

export const organizationsTools: McpToolDef[] = [
  {
    name: 'list_organizations',
    title: 'List organizations',
    description:
      'List all organizations the authenticated user is a member of, including their role in each. ' +
      'Only available with OAuth tokens (not legacy xph_* tokens).',
    area: 'general_xphere',
    inputSchema: z.object({}).strict(),
    handler: async (_input, { auth }) => {
      if (!auth.userId) {
        return {
          error: 'not_supported',
          detail: 'list_organizations requires OAuth authentication (not available with legacy tokens)',
        }
      }

      const { data, error } = await db()
        .from('org_members')
        .select('organization_id, role, organizations(id, name)')
        .eq('user_id', auth.userId)
        .order('created_at')

      if (error) return { error: 'query_failed', detail: error.message }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const organizations = (data ?? []).map((row: any) => ({
        id: row.organization_id as string,
        name: (row.organizations?.name ?? null) as string | null,
        role: row.role as string,
      }))

      return { organizations }
    },
  },
]
