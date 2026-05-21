// src/app/api/chat/[token]/route.ts
// Public POST endpoint for the Opps embedded chat widget.
// Authentication: org token in URL path (not a user session).
// Unlike /api/vapi/* routes, this returns 401 for invalid tokens (no Vapi retry concern).
//
// Persistence: writes to `conversations` and `conversation_messages` via persist.ts.
// Redis (session.ts) is a transient cache only | never the source of truth.
// See .planning/codebase/chat-data-boundary.md for the full data lifecycle.
import { after } from 'next/server'
import { z } from 'zod'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import { getSession, setSession, type ChatSessionContext } from '@/lib/chat/session'
import { ensureDbSession, persistMessage } from '@/lib/chat/persist'
import { runAgent } from '@/lib/agent-runtime'

export const runtime = 'nodejs'
export const maxDuration = 10

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS })
}

const ChatRequestSchema = z.object({
  message: z.string().min(1, 'message is required'),
  sessionId: z.string().optional(),
})

export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> }
): Promise<Response> {
  try {
    // 1. Await params (required in Next.js 15 App Router)
    const { token } = await params

    // 2. Parse + validate request body
    let rawBody: unknown
    try {
      rawBody = await request.json()
    } catch {
      return Response.json({ error: 'Invalid JSON body' }, { status: 400, headers: CORS_HEADERS })
    }

    const parsed = ChatRequestSchema.safeParse(rawBody)
    if (!parsed.success) {
      return Response.json({ error: parsed.error.errors[0]?.message ?? 'Invalid request' }, { status: 400, headers: CORS_HEADERS })
    }
    const { message, sessionId: incomingSessionId } = parsed.data

    // 3. Resolve org by widget token
    const supabase = createServiceRoleClient()
    const { data: org, error: orgError } = await supabase
      .from('organizations')
      .select('id, name, is_active')
      .eq('widget_token', token)
      .single()

    if (orgError || !org || !org.is_active) {
      return Response.json({ error: 'Invalid or inactive token' }, { status: 401, headers: CORS_HEADERS })
    }

    // 4. Get or create session
    let ctx: ChatSessionContext
    let sessionId: string

    if (incomingSessionId) {
      const existing = await getSession(incomingSessionId)
      if (existing && existing.orgId === org.id) {
        // Resume existing session
        ctx = existing
        sessionId = incomingSessionId
      } else {
        // Redis miss or org mismatch | treat as new session
        sessionId = crypto.randomUUID()
        const dbSessionId = await ensureDbSession({ orgId: org.id, sessionId, widgetToken: token })
        ctx = {
          orgId: org.id,
          sessionId,
          dbSessionId,
          messages: [],
          createdAt: new Date().toISOString(),
          lastActiveAt: new Date().toISOString(),
        }
      }
    } else {
      // First message | create new session
      sessionId = crypto.randomUUID()
      const dbSessionId = await ensureDbSession({ orgId: org.id, sessionId, widgetToken: token })
      ctx = {
        orgId: org.id,
        sessionId,
        dbSessionId,
        messages: [],
        createdAt: new Date().toISOString(),
        lastActiveAt: new Date().toISOString(),
      }
    }

    // 5. Append user message to context and refresh Redis
    ctx.messages.push({ role: 'user', content: message })
    ctx.lastActiveAt = new Date().toISOString()
    await setSession(sessionId, ctx)

    // 6. Persist user message to Supabase (fire-and-forget via after())
    after(async () => {
      try {
        await persistMessage({ dbSessionId: ctx.dbSessionId, orgId: ctx.orgId, role: 'user', content: message })
      } catch (err) {
        console.error('[chat-api] persistMessage failed:', err)
      }
    })

    // 7. Call agent runtime | resolves agent, runs LLM, persists assistant reply (D-35-06)
    const stream = runAgent({
      orgId: org.id,
      channel: 'web_widget',
      conversationId: ctx.dbSessionId,
      sessionId,
      userMessage: message,
      historyWindow: ctx.messages,
      mode: 'production',
      stream: true,
    })

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        ...CORS_HEADERS,
      },
    })
  } catch (err) {
    console.error('[chat-api] unhandled error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500, headers: CORS_HEADERS })
  }
}
