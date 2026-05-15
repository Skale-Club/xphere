// src/lib/chat/stream.ts
// Shared ReadableStream builder and SSE encoder for the chat API.
// Returns a ReadableStream that emits newline-delimited JSON events per D-02.
//
// IMPORTANT: accumulatedReply is set via the onToken callback so the caller
// (route.ts) can close over it before registering after() — see Pitfall 3 in 03-RESEARCH.md.
//
// Provider-specific streaming, tool schema definitions, and the SSE encoder
// live in src/lib/chat/stream/*. This file orchestrates them.

import { queryKnowledge } from '@/lib/knowledge/query-knowledge'
import { getProviderKey } from '@/lib/integrations/get-provider-key'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import type { ChatSessionContext } from '@/lib/chat/session'
import { createEncoder } from './stream/encoder'
import { buildAnthropicTools, buildOpenAiTools } from './stream/tool-schemas'
import { streamOpenRouter } from './stream/openrouter'
import { streamAnthropic } from './stream/anthropic'

type ActionType = Database['public']['Enums']['action_type']

const FALLBACK_RESPONSE = "I don't have information about that in my knowledge base."

const DEGRADATION_MESSAGE =
  'This assistant is not yet configured. Please contact the site owner.'

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
  /** Accumulate reply text — caller declares `let accumulatedReply = ''` in route scope */
  onReplyChunk: (chunk: string) => void
}

/**
 * Build a readable stream that calls the LLM and emits SSE events.
 * Pre-retrieves KB context, then streams tokens through a single controller.
 * Handles single tool call round-trip before streaming the final answer.
 */
export function createChatStream(params: CreateChatStreamParams): ReadableStream {
  const {
    sessionId,
    orgId,
    orgName,
    message,
    ctx,
    supabase,
    toolsWithCreds,
    onReplyChunk,
  } = params

  return new ReadableStream({
    async start(controller) {
      const encode = createEncoder()

      // Helper: enqueue a JSON SSE line
      const emit = (obj: object) => controller.enqueue(encode(obj))

      try {
        // Always emit session event first (D-02)
        emit({ event: 'session', sessionId })

        // Step A: Fetch provider keys (D-11)
        const openrouterKey = await getProviderKey('openrouter', orgId, supabase)
        const anthropicKey = await getProviderKey('anthropic', orgId, supabase)

        if (!openrouterKey && !anthropicKey) {
          // D-12: No keys — graceful degradation
          emit({ event: 'token', text: DEGRADATION_MESSAGE })
          onReplyChunk(DEGRADATION_MESSAGE)
          emit({ event: 'done' })
          controller.close()
          return
        }

        // Step B: Pre-retrieval KB injection (CHAT-02, Pattern 4)
        let kbContext = ''
        try {
          const kbResult = await queryKnowledge(message, orgId, supabase)
          if (kbResult !== FALLBACK_RESPONSE) {
            kbContext = `\n\nRelevant knowledge base content:\n${kbResult}`
          }
        } catch {
          // KB failure is non-fatal — continue without context
        }

        const systemPrompt = `You are a helpful assistant for ${orgName}. Answer questions accurately and concisely using the provided context. If you don't know the answer, say so.${kbContext}`

        // Step C: Build message history window (D-14)
        const historyWindow = ctx.messages.slice(-10)

        if (openrouterKey) {
          // OpenRouter path (D-11 first preference)
          await streamOpenRouter({
            apiKey: openrouterKey,
            systemPrompt,
            historyWindow,
            message,
            tools: buildOpenAiTools(toolsWithCreds),
            toolsWithCreds,
            orgId,
            supabase,
            emit,
            onReplyChunk,
          })
        } else {
          // Anthropic fallback path
          await streamAnthropic({
            apiKey: anthropicKey!,
            systemPrompt,
            historyWindow,
            message,
            tools: buildAnthropicTools(toolsWithCreds),
            toolsWithCreds,
            orgId,
            supabase,
            emit,
            onReplyChunk,
          })
        }

        emit({ event: 'done' })
      } catch (err) {
        console.error('[stream] Unhandled error:', err)
        emit({ event: 'token', text: 'An error occurred. Please try again.' })
        onReplyChunk('An error occurred. Please try again.')
        emit({ event: 'done' })
      } finally {
        controller.close()
      }
    },
  })
}
