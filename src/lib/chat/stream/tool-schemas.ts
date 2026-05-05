// src/lib/chat/stream/tool-schemas.ts
// Tool schema definitions and per-provider tool builders extracted from stream.ts.
// Per 03-RESEARCH.md open question resolution: hardcode parameter shapes per action_type.
//
// Note: TOOL_SCHEMAS was previously duplicated inside both buildOpenAiTools and
// buildAnthropicTools in stream.ts. This module unifies them into a single const.

import type OpenAI from 'openai'
import type Anthropic from '@anthropic-ai/sdk'
import type { ToolWithCredentials } from '../stream'

const TOOL_SCHEMAS: Record<string, { description: string; properties: object; required: string[] }> = {
  create_contact: {
    description: 'Create a new contact in the CRM',
    properties: {
      firstName: { type: 'string' },
      lastName: { type: 'string' },
      email: { type: 'string' },
      phone: { type: 'string' },
    },
    required: ['firstName', 'lastName'],
  },
  get_availability: {
    description: 'Check available appointment slots',
    properties: {
      calendarId: { type: 'string' },
      startDate: { type: 'string', description: 'ISO date string' },
      endDate: { type: 'string', description: 'ISO date string' },
    },
    required: ['calendarId', 'startDate', 'endDate'],
  },
  create_appointment: {
    description: 'Book an appointment',
    properties: {
      calendarId: { type: 'string' },
      contactId: { type: 'string' },
      startTime: { type: 'string', description: 'ISO datetime string' },
      endTime: { type: 'string', description: 'ISO datetime string' },
    },
    required: ['calendarId', 'contactId', 'startTime', 'endTime'],
  },
}

/**
 * Build the Anthropic-format tool definitions from the org's active tool_configs.
 */
export function buildAnthropicTools(tools: ToolWithCredentials[]): Anthropic.Tool[] {
  return tools
    .filter(t => t.action_type in TOOL_SCHEMAS)
    .map(t => {
      const schema = TOOL_SCHEMAS[t.action_type]!
      return {
        name: t.tool_name,
        description: (t.config.description as string | undefined) ?? schema.description,
        input_schema: {
          type: 'object' as const,
          properties: schema.properties,
          required: schema.required,
        },
      }
    })
}

/**
 * Build the OpenAI-format tool definitions from the org's active tool_configs.
 */
export function buildOpenAiTools(tools: ToolWithCredentials[]): OpenAI.ChatCompletionTool[] {
  return tools
    .filter(t => t.action_type in TOOL_SCHEMAS)
    .map(t => {
      const schema = TOOL_SCHEMAS[t.action_type]!
      return {
        type: 'function' as const,
        function: {
          name: t.tool_name,
          description: (t.config.description as string | undefined) ?? schema.description,
          parameters: {
            type: 'object',
            properties: schema.properties,
            required: schema.required,
          },
        },
      }
    })
}
