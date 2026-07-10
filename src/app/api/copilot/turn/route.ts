// Streaming Copilot turn. Same auth/gating/persistence as the server action
// (shared core in lib/copilot/execute-turn.ts), but emits Server-Sent Events
// so the panel renders text blocks and tool calls as they happen instead of
// blocking on the whole multi-turn loop.
//
// Event protocol (one JSON object per `data:` line):
//   { type: 'part',  part: MessagePart }        — emitted as the turn progresses
//   { type: 'done',  data: CopilotTurnOutput }  — terminal, turn persisted
//   { type: 'error', error: string }            — terminal
//
// This is an authenticated first-party endpoint (Supabase session cookie),
// NOT an always-200 inbound webhook — errors surface as SSE error events.

import { executeCopilotTurn, type CopilotTurnInput } from '@/lib/copilot/execute-turn'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  let input: CopilotTurnInput
  try {
    const body = (await request.json()) as Partial<CopilotTurnInput>
    if (!body || typeof body.conversationId !== 'string' || typeof body.message !== 'string') {
      return Response.json({ error: 'invalid_body' }, { status: 422 })
    }
    input = {
      conversationId: body.conversationId,
      message: body.message,
      images: Array.isArray(body.images) ? body.images.filter((i) => typeof i === 'string') : undefined,
      writeMode: Boolean(body.writeMode),
      currentEntity: body.currentEntity ?? null,
    }
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 422 })
  }

  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false
      const send = (event: unknown) => {
        if (closed) return
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
        } catch {
          closed = true // client disconnected — the turn still completes and persists
        }
      }

      try {
        const result = await executeCopilotTurn(input, {
          onPart: (part) => send({ type: 'part', part }),
        })
        if (result.ok) send({ type: 'done', data: result.data })
        else send({ type: 'error', error: result.error })
      } catch (err) {
        send({ type: 'error', error: err instanceof Error ? err.message : String(err) })
      } finally {
        if (!closed) controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  })
}
