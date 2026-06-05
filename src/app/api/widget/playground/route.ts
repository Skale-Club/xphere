// src/app/api/widget/playground/route.ts
// Authenticated endpoint for the widget settings playground.
// Runs the agent in-memory (mode='playground') — NO conversation, NO message
// persistence. Test messages never appear in the Chat inbox.
import { z } from 'zod'
import { createClient, getUser } from '@/lib/supabase/server'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import { runAgent } from '@/lib/agent-runtime'

export const runtime = 'nodejs'
export const maxDuration = 30

const BodySchema = z.object({
  widgetToken: z.string().min(1),
  message: z.string().min(1),
  history: z.array(z.object({
    role: z.enum(['user', 'assistant']),
    content: z.string(),
  })).optional().default([]),
})

export async function POST(request: Request): Promise<Response> {
  // 1. Auth — must be a logged-in user
  const user = await getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  // 2. Parse body
  let raw: unknown
  try { raw = await request.json() } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const parsed = BodySchema.safeParse(raw)
  if (!parsed.success) return Response.json({ error: parsed.error.errors[0]?.message }, { status: 400 })
  const { widgetToken, message, history } = parsed.data

  // 3. Resolve org by token, verify the caller belongs to it
  const admin = createServiceRoleClient()
  const { data: org } = await admin
    .from('organizations')
    .select('id, is_active')
    .eq('widget_token', widgetToken)
    .single()
  if (!org?.is_active) return Response.json({ error: 'Invalid token' }, { status: 401 })

  const supabase = await createClient()
  const { data: orgId } = await supabase.rpc('get_current_org_id')
  if (orgId !== org.id) return Response.json({ error: 'Forbidden' }, { status: 403 })

  // 4. Run agent in playground mode — no conversationId → no DB writes
  const traceId = crypto.randomUUID()
  const stream = runAgent({
    orgId: org.id,
    traceId,
    sessionId: traceId, // emitted as { event: 'session', sessionId } so the playground can display it
    channel: 'web_widget',
    userMessage: message,
    historyWindow: history,
    mode: 'playground',
    stream: true,
    // No conversationId — persistMessage is gated on this being present
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
    },
  })
}
