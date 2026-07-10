// SEED-033: derive a Zod input schema for an agent-callable workflow.
//
// Reads the `input_schema` declared on the workflow trigger (in YAML/JSON):
//
//   trigger:
//     type: tool_call
//     config:
//       tool_name: send_sms
//       input_schema:
//         to:   { type: string, description: "...", required: true }
//         body: { type: string, required: true }
//
// Returns a Zod object that the ai-sdk dynamicTool() can consume as its
// `parameters`. Unknown types fall back to z.string() so the LLM still has a
// usable shape.

import { z } from 'zod'

export interface InputSchemaField {
  type?: string
  description?: string
  required?: boolean
  enum?: unknown[]
}

export type InputSchemaMap = Record<string, InputSchemaField>

function extractInputSchemaMap(definition: unknown): InputSchemaMap {
  if (!definition || typeof definition !== 'object') return {}
  const def = definition as Record<string, unknown>

  // YAML-style: definition.trigger.config.input_schema
  const trigger = def.trigger as Record<string, unknown> | undefined
  const triggerConfig = (trigger?.config ?? {}) as Record<string, unknown>
  const fromTrigger = triggerConfig.input_schema as InputSchemaMap | undefined
  if (fromTrigger && typeof fromTrigger === 'object') return fromTrigger

  // workflows row shape (trigger_config column): pre-flattened
  const triggerConfigField = def.trigger_config as Record<string, unknown> | undefined
  const fromRow = triggerConfigField?.input_schema as InputSchemaMap | undefined
  if (fromRow && typeof fromRow === 'object') return fromRow

  return {}
}

function fieldToZod(meta: InputSchemaField): z.ZodTypeAny {
  let field: z.ZodTypeAny
  // A declared string enum becomes a Zod enum so the agent tool boundary
  // actually constrains the value to the allowed set (the input_schema promises
  // it; dropping it let any string through).
  const enumValues = Array.isArray(meta.enum)
    ? meta.enum.filter((v): v is string => typeof v === 'string')
    : []
  if (
    enumValues.length > 0 &&
    enumValues.length === (meta.enum?.length ?? 0) &&
    (meta.type === undefined || meta.type === 'string')
  ) {
    field = z.enum(enumValues as [string, ...string[]])
  } else {
    switch (meta.type) {
      case 'number':
      case 'integer':
        field = z.number()
        break
      case 'boolean':
        field = z.boolean()
        break
      case 'array':
        field = z.array(z.unknown())
        break
      case 'object':
        field = z.record(z.unknown())
        break
      case 'string':
      default:
        field = z.string()
        break
    }
  }
  if (meta.description) field = field.describe(meta.description)
  if (meta.required === false || meta.required === undefined) field = field.optional()
  return field
}

export function deriveWorkflowInputSchema(
  definition: unknown,
): z.ZodObject<Record<string, z.ZodTypeAny>> {
  const map = extractInputSchemaMap(definition)
  const shape: Record<string, z.ZodTypeAny> = {}
  for (const [key, meta] of Object.entries(map)) {
    if (!meta || typeof meta !== 'object') continue
    shape[key] = fieldToZod(meta as InputSchemaField)
  }
  return z.object(shape)
}

// Returns the raw map without converting to Zod | useful for spec output.
export function getWorkflowInputSchema(definition: unknown): InputSchemaMap {
  return extractInputSchemaMap(definition)
}

export function getWorkflowOutputSchema(definition: unknown): InputSchemaMap {
  if (!definition || typeof definition !== 'object') return {}
  const def = definition as Record<string, unknown>
  const trigger = def.trigger as Record<string, unknown> | undefined
  const triggerConfig = (trigger?.config ?? {}) as Record<string, unknown>
  const out = triggerConfig.output_schema as InputSchemaMap | undefined
  if (out && typeof out === 'object') return out

  const triggerConfigField = def.trigger_config as Record<string, unknown> | undefined
  const fromRow = triggerConfigField?.output_schema as InputSchemaMap | undefined
  if (fromRow && typeof fromRow === 'object') return fromRow

  return {}
}
