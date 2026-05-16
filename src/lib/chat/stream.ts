// src/lib/chat/stream.ts
// createChatStream shim — delegates to runAgent({ stream: true }) (Phase 35 D-35-04).
// Preserved through Phase 38 for safe rollback.
// One-line revert: swap route.ts back to createChatStream call.

import { runAgent } from '@/lib/agent-runtime'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import type { ChatSessionContext } from '@/lib/chat/session'

type ActionType = Database['public']['Enums']['action_type']

export interface ToolConfigRow {
  id: string
  tool_name: string
  action_type: ActionType
  config: Record<string, unknown>
  fallback_message: string
  integration_id: string
}

export interface ToolWithCredentials extends ToolConfigRow {
  apiKey: string
  locationId: string
  provider: Database['public']['Enums']['integration_provider']
}

export interface CreateChatStreamParams {
  sessionId: string
  orgId: string
  orgName: string
  message: string
  ctx: ChatSessionContext
  supabase: SupabaseClient<Database>
  toolsWithCreds: ToolWithCredentials[]
  onReplyChunk: (chunk: string) => void
}

/**
 * createChatStream shim — delegates to runAgent({ stream: true }).
 * Signature preserved for rollback safety through Phase 38.
 * onReplyChunk is intentionally ignored — accumulation now happens inside runAgent.
 */
export function createChatStream(params: CreateChatStreamParams): ReadableStream {
  return runAgent({
    stream: true,
    orgId: params.orgId,
    sessionId: params.sessionId,
    channel: 'web_widget',
    userMessage: params.message,
    conversationId: params.ctx.dbSessionId,
    historyWindow: params.ctx.messages,
    mode: 'production',
  })
}
