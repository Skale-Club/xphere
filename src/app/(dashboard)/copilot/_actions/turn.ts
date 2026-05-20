'use server'

import { createClient, getUser } from '@/lib/supabase/server'
import { runCopilotTurn, type MessagePart } from '@/lib/copilot/run-turn'

type ActionResult<T = void> = { ok: true; data: T } | { ok: false; error: string }

export interface SendMessageInput {
  conversationId: string
  message: string
  images?: string[]      // base64 data URLs (max ~800px, compressed client-side)
  writeMode?: boolean
  currentEntity?: { type: 'contact' | 'account' | 'opportunity'; id: string } | null
}

export interface SendMessageResult {
  userMessageId: string
  assistantMessageId: string
  assistantParts: MessagePart[]
  runId: string
  provider: string
  model: string
  costUsd: number
  inputTokens: number
  outputTokens: number
}

export async function sendCopilotMessage(
  input: SendMessageInput,
): Promise<ActionResult<SendMessageResult>> {
  const user = await getUser()
  if (!user) return { ok: false, error: 'not_authenticated' }
  if (!input.message.trim()) return { ok: false, error: 'empty_message' }

  const supabase = await createClient()
  const { data: orgId } = await supabase.rpc('get_current_org_id')
  if (!orgId) return { ok: false, error: 'no_active_org' }

  // Verify the conversation belongs to the active org (RLS enforces, but a
  // null check gives a cleaner error than a permission failure mid-turn).
  const { data: conv } = await supabase
    .from('copilot_conversations')
    .select('id')
    .eq('id', input.conversationId)
    .maybeSingle()
  if (!conv) return { ok: false, error: 'conversation_not_found' }

  // Load history before persisting the new user message so it isn't sent twice.
  const { data: historyRows } = await supabase
    .from('copilot_messages')
    .select('role, parts')
    .eq('conversation_id', input.conversationId)
    .order('created_at', { ascending: true })

  const history = (historyRows ?? []).map((r) => ({
    role: r.role as 'user' | 'assistant',
    parts: (r.parts as unknown as MessagePart[]) ?? [],
  }))

  // Persist the user message (text + any image parts).
  const userParts: Record<string, unknown>[] = [
    { type: 'text', text: input.message },
    ...(input.images ?? []).map((url) => ({ type: 'image', url })),
  ]
  const { data: userMsg, error: userMsgErr } = await supabase
    .from('copilot_messages')
    .insert({
      conversation_id: input.conversationId,
      role: 'user',
      parts: userParts as unknown as Record<string, unknown>[],
    })
    .select('id')
    .single()
  if (userMsgErr || !userMsg) {
    return { ok: false, error: userMsgErr?.message ?? 'user_msg_insert_failed' }
  }

  try {
    const result = await runCopilotTurn({
      supabase,
      orgId: orgId as string,
      userId: user.id,
      conversationId: input.conversationId,
      userMessage: input.message,
      images: input.images,
      writeMode: Boolean(input.writeMode),
      currentEntity: input.currentEntity ?? null,
      history,
    })

    const { data: asstMsg, error: asstMsgErr } = await supabase
      .from('copilot_messages')
      .insert({
        conversation_id: input.conversationId,
        role: 'assistant',
        parts: result.parts as unknown as Record<string, unknown>[],
        metadata: {
          run_id: result.runId,
          provider: result.provider,
          model: result.model,
          input_tokens: result.inputTokens,
          output_tokens: result.outputTokens,
          cost_usd: result.costUsd,
        },
      })
      .select('id')
      .single()
    if (asstMsgErr || !asstMsg) {
      return { ok: false, error: asstMsgErr?.message ?? 'assistant_msg_insert_failed' }
    }

    // Auto-name the conversation off the first user turn.
    if (history.length === 0) {
      const slug = input.message.trim().slice(0, 60)
      await supabase
        .from('copilot_conversations')
        .update({ title: slug })
        .eq('id', input.conversationId)
    } else {
      await supabase
        .from('copilot_conversations')
        .update({ updated_at: new Date().toISOString() })
        .eq('id', input.conversationId)
    }

    return {
      ok: true,
      data: {
        userMessageId: userMsg.id,
        assistantMessageId: asstMsg.id,
        assistantParts: result.parts,
        runId: result.runId,
        provider: result.provider,
        model: result.model,
        costUsd: result.costUsd,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
      },
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { ok: false, error: msg }
  }
}
