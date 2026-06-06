// POST /api/chat/conversations/[id]/feedback
// Submits a quality signal for an agent response in a conversation (Q7, Project 2).
//
// Auth: session-based (authenticated org member or API key via service role).
// Returns 201 on success, 400 on bad input, 401 when unauthenticated.

import { z } from 'zod'
import { createClient, getUser } from '@/lib/supabase/server'
import { createLogger } from '@/lib/obs/logger'

export const runtime = 'nodejs'

const log = createLogger({ route: 'api/chat/conversations/[id]/feedback' })

const bodySchema = z.object({
  signal: z.enum(['thumbs_up', 'thumbs_down', 'handoff', 'idk']),
  invocation_id: z.string().uuid().optional().nullable(),
  message_id: z.string().uuid().optional().nullable(),
  note: z.string().max(1000).optional().nullable(),
})

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const user = await getUser()
  if (!user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id: conversationId } = await params

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) {
    return Response.json(
      { error: 'Validation error', issues: parsed.error.issues },
      { status: 400 },
    )
  }

  const { signal, invocation_id, message_id, note } = parsed.data

  const supabase = await createClient()

  // Verify conversation belongs to the user's current org (RLS enforces this)
  const { data: conv, error: convErr } = await supabase
    .from('conversations')
    .select('id, org_id')
    .eq('id', conversationId)
    .single()

  if (convErr || !conv) {
    return Response.json({ error: 'Conversation not found' }, { status: 404 })
  }

  const { error: insertErr } = await supabase.from('agent_feedback').insert({
    org_id: conv.org_id,
    conversation_id: conversationId,
    invocation_id: invocation_id ?? null,
    message_id: message_id ?? null,
    signal,
    note: note ?? null,
    submitted_by: user.id,
  })

  if (insertErr) {
    log.error('feedback_insert_failed', {
      conversationId,
      signal,
      error: insertErr.message,
    })
    return Response.json({ error: 'Failed to save feedback' }, { status: 500 })
  }

  return Response.json({ ok: true }, { status: 201 })
}
