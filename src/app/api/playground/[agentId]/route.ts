// src/app/api/playground/[agentId]/route.ts
// Authenticated playground endpoint | streams agent responses without persisting to conversations.
// mode='playground' tags the agent_invocations row; no conversationId is passed so
// conversation_messages are never written (PLAY-04, PLAY-05).

import { z } from 'zod'
import { getUser } from '@/lib/supabase/server'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import { runAgent } from '@/lib/agent-runtime'
import type { AgentChannel } from '@/lib/agent-runtime/types'

export const runtime = 'nodejs'
export const maxDuration = 30

const PlaygroundRequestSchema = z.object({
  message: z.string().min(1, 'message is required'),
  channel: z
    .enum(['web_widget', 'whatsapp', 'messenger', 'instagram', 'manychat', 'telegram'])
    .default('web_widget'),
  sessionId: z.string().optional(),
  historyWindow: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string(),
      })
    )
    .optional(),
})

export async function POST(
  request: Request,
  { params }: { params: Promise<{ agentId: string }> }
): Promise<Response> {
  // 1. Auth check | must be logged in
  const user = await getUser()
  if (!user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // 2. Await params (Next.js 15 requirement)
  const { agentId } = await params

  // 3. Parse body
  let rawBody: unknown
  try {
    rawBody = await request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = PlaygroundRequestSchema.safeParse(rawBody)
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.errors[0]?.message ?? 'Invalid request' },
      { status: 400 }
    )
  }
  const { message, channel, sessionId, historyWindow } = parsed.data

  // 4. Verify agent belongs to user's org (security check)
  const supabase = createServiceRoleClient()
  const { data: membership } = await supabase
    .from('org_members')
    .select('organization_id')
    .eq('user_id', user.id)
    .single()

  if (!membership) {
    return Response.json({ error: 'No organization found' }, { status: 403 })
  }

  const { data: agent } = await supabase
    .from('agents')
    .select('id')
    .eq('id', agentId)
    .eq('organization_id', membership.organization_id)
    .single()

  if (!agent) {
    return Response.json({ error: 'Agent not found' }, { status: 404 })
  }

  // 5. Stream agent response
  // PLAY-05: conversationId deliberately omitted | runAgentStreaming only persists
  // conversation_messages when conversationId is truthy. Omitting it means zero
  // rows written to conversations or conversation_messages tables.
  // PLAY-04: mode='playground' tags the agent_invocations row.
  const stream = runAgent({
    orgId: membership.organization_id,
    agentId,
    channel: channel as AgentChannel,
    userMessage: message,
    sessionId,
    historyWindow: historyWindow ?? [],
    mode: 'playground',
    stream: true,
    // conversationId deliberately omitted | no persistence to conversations table
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
    },
  })
}
