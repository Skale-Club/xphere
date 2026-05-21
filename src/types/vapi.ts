// src/types/vapi.ts
// Zod schemas for Vapi tool-call webhook payloads
// Validated against Vapi API reference 2024 | assistantId is camelCase, lives at message.call

import { z } from 'zod'

// Individual tool call within a toolCallList
export const VapiToolCallSchema = z.object({
  id: z.string(),
  name: z.string(),
  // Vapi docs show both 'arguments' (newer) and 'parameters' (older). Accept both defensively.
  arguments: z.record(z.unknown()).optional(),
  parameters: z.record(z.unknown()).optional(),
})

export type VapiToolCall = z.infer<typeof VapiToolCallSchema>

// Full tool-call message envelope
export const VapiToolCallMessageSchema = z.object({
  message: z.object({
    type: z.literal('tool-calls'),
    call: z.object({
      id: z.string(),
      assistantId: z.string(),   // camelCase | confirmed from Vapi API reference
      orgId: z.string().optional(),
    }).passthrough(),            // allow additional Vapi fields without validation failure
    toolCallList: z.array(VapiToolCallSchema),
  }),
})

export type VapiToolCallMessage = z.infer<typeof VapiToolCallMessageSchema>

// Helper: coalesce arguments/parameters field (Vapi sends either depending on version)
export function getToolArguments(toolCall: VapiToolCall): Record<string, unknown> {
  return toolCall.arguments ?? toolCall.parameters ?? {}
}

// ---------------------------------------------------------------------------
// End-of-call webhook schemas (OBS-01)
// ---------------------------------------------------------------------------

export const ArtifactMessageSchema = z.object({
  role: z.string(),
  message: z.string().optional(),
  time: z.number().optional(),
  endTime: z.number().optional(),
  secondsFromStart: z.number().optional(),
  toolCalls: z.array(z.record(z.unknown())).optional(),
  result: z.string().optional(),
}).passthrough()

export type ArtifactMessage = z.infer<typeof ArtifactMessageSchema>

export const VapiEndOfCallMessageSchema = z.object({
  message: z.object({
    type: z.literal('end-of-call-report'),
    endedReason: z.string(),
    startedAt: z.string().optional(),
    endedAt: z.string().optional(),
    cost: z.number().optional(),
    call: z.object({
      id: z.string(),
      assistantId: z.string().optional(),
      orgId: z.string().optional(),
      status: z.string().optional(),
      type: z.string().optional(),
      startedAt: z.string().optional(),
      endedAt: z.string().optional(),
      cost: z.number().optional(),
      customer: z.object({
        number: z.string().optional(),
        name: z.string().optional(),
      }).optional(),
    }).passthrough().optional(),
    artifact: z.object({
      transcript: z.string().optional(),
      messages: z.array(ArtifactMessageSchema).optional(),
    }).passthrough().optional(),
    analysis: z.object({
      summary: z.string().optional(),
      successEvaluation: z.string().optional(),
      structuredData: z.record(z.unknown()).optional(),
    }).optional(),
  }),
})

export type VapiEndOfCallMessage = z.infer<typeof VapiEndOfCallMessageSchema>
