// PATCH /api/chat/conversations/[id]/bot-status — toggle bot active/paused
// 'active'  → bot responds to inbound messages (default)
// 'paused'  → bot suppressed; human operator handles conversation
import { createClient, getUser } from '@/lib/supabase/server'
import { z } from 'zod'

export const runtime = 'nodejs'

const BotStatusSchema = z.object({
  bot_status: z.enum(['active', 'paused']),
})

export async function PATCH(
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

  const parsed = BotStatusSchema.safeParse(body)
  if (!parsed.success) {
    return Response.json({ error: 'bot_status must be "active" or "paused"' }, { status: 400 })
  }

  const supabase = await createClient()
  const { error } = await supabase
    .from('conversations')
    .update({ bot_status: parsed.data.bot_status, updated_at: new Date().toISOString() })
    .eq('id', id)

  if (error) {
    console.error('[PATCH bot-status]', error)
    return Response.json({ error: 'Failed to update bot_status' }, { status: 500 })
  }

  return Response.json({ ok: true, bot_status: parsed.data.bot_status })
}
