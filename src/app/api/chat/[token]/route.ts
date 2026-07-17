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
import { createLogger } from '@/lib/obs/logger'
import { isRequestAllowed, normalizeWidgetUrlMode, normalizeWidgetUrlRules } from '@/lib/widget/url-rules'
import { rateLimit } from '@/lib/rate-limit'
import { getClientIp } from '@/lib/request-ip'

export const runtime = 'nodejs'
// 60s for tool round-trips (Phases 132+). NOTE: on self-hosted Coolify this is platform build-output metadata only — no runtime enforcement (Next 16 docs); the effective ceiling is the Traefik proxy timeout. Zero behavioral change today, required for platform portability.
export const maxDuration = 60

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS })
}

const ChatRequestSchema = z.object({
  message: z.string().min(1, 'message is required').max(4000, 'message too long'),
  sessionId: z.string().optional(),
  // Full page URL, sent by the widget so URL rules can be enforced at path level
  // (browsers strip the path from cross-origin Referer). The host is still
  // verified against the unspoofable Origin header before the path is trusted.
  pageUrl: z.string().optional(),
})

// Plain JSON, never a stream — the widget shows non-200s as an error bubble.
function rateLimited(): Response {
  return Response.json({ error: 'rate_limited' }, { status: 429, headers: CORS_HEADERS })
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> }
): Promise<Response> {
  // Correlation id for this request, propagated into the agent run (O1b).
  const traceId = crypto.randomUUID()
  const log = createLogger({ traceId, route: 'api/chat' })
  try {
    // 1. Await params (required in Next.js 15 App Router)
    const { token } = await params

    // Rate limits R1/R2 (contract §7) — per-IP, before ANY body parse or DB work.
    const ip = getClientIp(request)
    const r1 = await rateLimit(`chat:ip:${ip}`, 20, 60, { failMode: 'memory' })
    if (!r1.allowed) {
      log.warn('chat_rate_limited', { rule: 'R1', ip })
      return rateLimited()
    }
    const r2 = await rateLimit(`chat:ip:day:${ip}`, 200, 86400, { failMode: 'memory' })
    if (!r2.allowed) {
      log.warn('chat_rate_limited', { rule: 'R2', ip })
      return rateLimited()
    }

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
    const { message, sessionId: incomingSessionId, pageUrl } = parsed.data

    // 3. Resolve org by widget token
    const supabase = createServiceRoleClient()
    const { data: org, error: orgError } = await supabase
      .from('organizations')
      .select('id, name, is_active, widget_url_mode, widget_url_rules')
      .eq('widget_token', token)
      .single()

    if (orgError || !org || !org.is_active) {
      return Response.json({ error: 'Invalid or inactive token' }, { status: 401, headers: CORS_HEADERS })
    }

    // R5 — org LLM budget (fail-open: Redis down must not take every org's chat down).
    const r5 = await rateLimit(`chat:org:${org.id}`, 300, 60, { failMode: 'open' })
    if (!r5.allowed) {
      log.warn('chat_rate_limited', { rule: 'R5', ip, orgId: org.id })
      return rateLimited()
    }

    // 3b. Enforce URL authorization rules server-side. This is the real security
    // boundary against token reuse on unauthorized domains: the Origin header is
    // browser-set and cannot be forged by page JS.
    const allowed = isRequestAllowed(
      normalizeWidgetUrlMode(org.widget_url_mode),
      normalizeWidgetUrlRules(org.widget_url_rules),
      {
        origin: request.headers.get('origin'),
        referer: request.headers.get('referer'),
        clientUrl: pageUrl ?? null,
      },
    )
    if (!allowed) {
      return Response.json({ error: 'not_authorized_for_origin' }, { status: 403, headers: CORS_HEADERS })
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
        log.error('persist_user_message_failed', { error: err, orgId: ctx.orgId })
      }
    })

    // 7. Call agent runtime | resolves agent, runs LLM, persists assistant reply (D-35-06)
    const stream = runAgent({
      orgId: org.id,
      traceId,
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
    log.error('chat_unhandled_error', { error: err })
    return Response.json({ error: 'Internal server error' }, { status: 500, headers: CORS_HEADERS })
  }
}
