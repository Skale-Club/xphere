// src/lib/chat/stream/anthropic.ts
// Anthropic fallback streaming path extracted from stream.ts.
// Handles single tool call round-trip before streaming the final answer.

import Anthropic from '@anthropic-ai/sdk'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { executeAction } from '@/lib/action-engine/execute-action'
import type { ToolWithCredentials } from '../stream'

export interface StreamAnthropicParams {
  apiKey: string
  systemPrompt: string
  historyWindow: Array<{ role: 'user' | 'assistant'; content: string }>
  message: string
  tools: Anthropic.Tool[]
  toolsWithCreds: ToolWithCredentials[]
  orgId: string
  supabase: SupabaseClient<Database>
  emit: (obj: object) => void
  onReplyChunk: (chunk: string) => void
}

export async function streamAnthropic(p: StreamAnthropicParams): Promise<void> {
  const client = new Anthropic({ apiKey: p.apiKey })

  const anthropicMessages: Anthropic.MessageParam[] = [
    ...p.historyWindow.map(m => ({ role: m.role as 'user' | 'assistant', content: m.content })),
    { role: 'user', content: p.message },
  ]

  const streamParams: Anthropic.MessageStreamParams = {
    model: 'claude-3-5-haiku-20241022',
    max_tokens: 1024,
    system: p.systemPrompt,
    messages: anthropicMessages,
    ...(p.tools.length > 0 ? { tools: p.tools } : {}),
  }

  const msgStream = client.messages.stream(streamParams)

  let pendingToolName = ''

  for await (const event of msgStream) {
    if (event.type === 'content_block_start' && event.content_block.type === 'tool_use') {
      pendingToolName = event.content_block.name
      p.emit({ event: 'tool_call', name: pendingToolName })
    }
    if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
      p.emit({ event: 'token', text: event.delta.text })
      p.onReplyChunk(event.delta.text)
    }
  }

  const finalMsg = await msgStream.finalMessage()

  if (finalMsg.stop_reason === 'tool_use') {
    const toolUseBlock = finalMsg.content.find(
      (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use'
    )
    if (toolUseBlock) {
      let toolResult = ''
      try {
        const toolConfig = p.toolsWithCreds.find(t => t.tool_name === toolUseBlock.name)
        if (toolConfig) {
          toolResult = await executeAction(
            toolConfig.action_type,
            toolUseBlock.input as Record<string, unknown>,
            { apiKey: toolConfig.apiKey, locationId: toolConfig.locationId },
            { organizationId: p.orgId, supabase: p.supabase }
          )
        } else {
          toolResult = 'Tool not found'
        }
      } catch (err) {
        console.error('[stream/anthropic] tool call failed:', err)
        toolResult = 'Tool execution failed'
      }

      // Re-call with tool result for final answer
      const messagesWithTool: Anthropic.MessageParam[] = [
        ...anthropicMessages,
        { role: 'assistant', content: finalMsg.content },
        {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: toolUseBlock.id,
              content: toolResult,
            },
          ],
        },
      ]

      const finalStream = client.messages.stream({
        model: 'claude-3-5-haiku-20241022',
        max_tokens: 1024,
        system: p.systemPrompt,
        messages: messagesWithTool,
      })

      for await (const event of finalStream) {
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
          p.emit({ event: 'token', text: event.delta.text })
          p.onReplyChunk(event.delta.text)
        }
      }
    }
  }
}
