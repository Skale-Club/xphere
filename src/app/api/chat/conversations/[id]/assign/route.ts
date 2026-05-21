// POST /api/chat/conversations/[id]/assign | assign (or unassign) a human operator
// body: { user_id: string | null }
// null = unassign (returns conversation to pool)
import { createClient, getUser } from '@/lib/supabase/server'
import { z } from 'zod'

export const runtime = 'nodejs'

const AssignSchema = z.object({
  user_id: z.string().uuid().nullable(),
})

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const user = await getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params

  let body: unknown
  try { body = await request.json() } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const parsed = AssignSchema.safeParse(body)
  if (!parsed.success) {
    return Response.json({ error: 'user_id must be a UUID or null' }, { status: 400 })
  }

  const supabase = await createClient()

  // If assigning to a specific user, verify they are a member of the same org
  if (parsed.data.user_id) {
    const { data: member } = await supabase
      .from('org_members')
      .select('id')
      .eq('user_id', parsed.data.user_id)
      .maybeSingle()

    if (!member) {
      return Response.json({ error: 'User is not a member of this org' }, { status: 400 })
    }
  }

  const { error } = await supabase
    .from('conversations')
    .update({ assigned_user_id: parsed.data.user_id, updated_at: new Date().toISOString() })
    .eq('id', id)

  if (error) {
    console.error('[POST assign]', error)
    return Response.json({ error: 'Failed to assign user' }, { status: 500 })
  }

  return Response.json({ ok: true, assigned_user_id: parsed.data.user_id })
}
