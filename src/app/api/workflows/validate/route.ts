// SEED-026 Phase A: dry-run validation endpoint. POST a workflow definition
// (JSON or YAML-decoded JSON); receive structured errors back. No DB writes.

export const runtime = 'nodejs'

import { createClient, getUser } from '@/lib/supabase/server'
import { getWorkflowSpec } from '@/lib/workflows/spec'
import { validateWorkflow, type WorkflowDefinition } from '@/lib/workflows/validate'

export async function POST(request: Request) {
  try {
    const user = await getUser()
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    const supabase = await createClient()
    const { data: orgId } = await supabase.rpc('get_current_org_id')
    if (!orgId) return Response.json({ error: 'No active org' }, { status: 400 })

    const body = (await request.json()) as { definition?: WorkflowDefinition }
    if (!body?.definition) {
      return Response.json({ error: 'definition required' }, { status: 400 })
    }

    const spec = await getWorkflowSpec(orgId as string, supabase)
    const result = validateWorkflow(body.definition, spec)
    return Response.json(result)
  } catch (err) {
    console.error('[workflows/validate] error:', err)
    return Response.json({ error: 'Internal error' }, { status: 500 })
  }
}
