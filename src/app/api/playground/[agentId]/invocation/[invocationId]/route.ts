// src/app/api/playground/[agentId]/invocation/[invocationId]/route.ts
// Returns tool_calls JSON + timing for a completed playground invocation.
// Used by the playground UI to show tool-call details after streaming finishes.

import { getUser } from '@/lib/supabase/server'
import { createServiceRoleClient } from '@/lib/supabase/admin'

export const runtime = 'nodejs'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ agentId: string; invocationId: string }> }
): Promise<Response> {
  // Auth check
  const user = await getUser()
  if (!user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { agentId, invocationId } = await params

  const supabase = createServiceRoleClient()

  // Verify user has access to this org
  const { data: membership } = await supabase
    .from('org_members')
    .select('organization_id')
    .eq('user_id', user.id)
    .single()

  if (!membership) {
    return Response.json({ error: 'No organization found' }, { status: 403 })
  }

  // Fetch the invocation | filter by mode='playground' for security
  const { data: invocation } = await supabase
    .from('agent_invocations')
    .select('id, tool_calls, duration_ms, tokens_in, tokens_out, cost_usd, status, mode')
    .eq('id', invocationId)
    .eq('agent_id', agentId)
    .eq('organization_id', membership.organization_id)
    .eq('mode', 'playground')
    .single()

  if (!invocation) {
    return Response.json({ error: 'Invocation not found' }, { status: 404 })
  }

  return Response.json(invocation)
}
