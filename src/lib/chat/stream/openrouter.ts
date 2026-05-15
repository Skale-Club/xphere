// src/lib/chat/stream/openrouter.ts
// OpenRouter streaming path extracted from stream.ts.
// Handles single tool call round-trip before streaming the final answer.

import OpenAI from 'openai'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { executeAction } from '@/lib/action-engine/execute-action'
import type { ToolWithCredentials } from '../stream'

export interface StreamOpenRouterParams {
  apiKey: string
  systemPrompt: string
  historyWindow: Array<{ role: 'user' | 'assistant'; content: string }>
  message: string
  tools: OpenAI.ChatCompletionTool[]
  toolsWithCreds: ToolWithCredentials[]
  orgId: string
  supabase: SupabaseClient<Database>
  emit: (obj: object) => void
  onReplyChunk: (chunk: string) => void
}

export async function streamOpenRouter(p: StreamOpenRouterParams): Promise<void> {
  const client = new OpenAI({
    apiKey: p.apiKey,
    baseURL: 'https://openrouter.ai/api/v1',
  })

  const openaiMessages: OpenAI.ChatCompletionMessageParam[] = [
    { role: 'system', content: p.systemPrompt },
    ...p.historyWindow.map(m => ({ role: m.role as 'user' | 'assistant', content: m.content })),
    { role: 'user', content: p.message },
  ]

  const streamParams: OpenAI.ChatCompletionCreateParamsStreaming = {
    model: 'anthropic/claude-haiku-4-5',
    max_tokens: 1024,
    stream: true,
    messages: openaiMessages,
    ...(p.tools.length > 0 ? { tools: p.tools } : {}),
  }

  const completion = await client.chat.completions.create(streamParams)

  let toolCallName = ''
  let toolCallArguments = ''
  let toolCallId = ''

  for await (const chunk of completion) {
    const choice = chunk.choices[0]
    if (!choice) continue
    const delta = choice.delta

    if (delta?.content) {
      p.emit({ event: 'token', text: delta.content })
      p.onReplyChunk(delta.content)
    }

    if (delta?.tool_calls?.[0]) {
      const tc = delta.tool_calls[0]
      if (tc.id) toolCallId = tc.id
      if (tc.function?.name) toolCallName = tc.function.name
      if (tc.function?.arguments) toolCallArguments += tc.function.arguments
    }

    if (choice.finish_reason === 'tool_calls' && toolCallName) {
      // Emit tool_call event (D-07)
      p.emit({ event: 'tool_call', name: toolCallName })

      let toolResult = ''
      try {
        const toolConfig = p.toolsWithCreds.find(t => t.tool_name === toolCallName)
        if (toolConfig) {
          const toolInput = JSON.parse(toolCallArguments || '{}') as Record<string, unknown>
          toolResult = await executeAction(
            toolConfig.action_type,
            toolInput,
            { apiKey: toolConfig.apiKey, locationId: toolConfig.locationId },
            { organizationId: p.orgId, supabase: p.supabase, integrationProvider: toolConfig.provider }
          )
        } else {
          toolResult = 'Tool not found'
        }
      } catch (err) {
        console.error('[stream/openrouter] tool call failed:', err)
        toolResult = 'Tool execution failed'
      }

      // Re-call with tool result to get final answer (single ReadableStream controller stays open)
      const messagesWithTool: OpenAI.ChatCompletionMessageParam[] = [
        ...openaiMessages,
        {
          role: 'assistant',
          content: null,
          tool_calls: [{ id: toolCallId, type: 'function' as const, function: { name: toolCallName, arguments: toolCallArguments } }],
        },
        { role: 'tool', tool_call_id: toolCallId, content: toolResult },
      ]

      const finalStream = await client.chat.completions.create({
        model: 'anthropic/claude-haiku-4-5',
        max_tokens: 1024,
        stream: true,
        messages: messagesWithTool,
      })

      for await (const finalChunk of finalStream) {
        const finalContent = finalChunk.choices[0]?.delta?.content
        if (finalContent) {
          p.emit({ event: 'token', text: finalContent })
          p.onReplyChunk(finalContent)
        }
      }
    }
  }
}
