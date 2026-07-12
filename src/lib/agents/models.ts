/**
 * Hardcoded model dropdown for Phase 36. Anthropic-only today NOT because the
 * runtime can't reach other vendors (it can — the agent runtime resolves
 * OpenRouter first and OpenRouter fronts Claude, GPT, Llama, Gemini, etc, all
 * via the same call path) but because `agent_model_pricing` only has Anthropic
 * rows seeded, and cost accounting depends on a pricing match for the model
 * id. The list will widen once other vendors get pricing rows. Future: source
 * from DB.
 */
export const AVAILABLE_MODELS = [
  'anthropic/claude-sonnet-4-6',
  'anthropic/claude-opus-4-7',
  'anthropic/claude-haiku-4-5',
] as const

export type AvailableModel = (typeof AVAILABLE_MODELS)[number]
export const DEFAULT_MODEL: AvailableModel = 'anthropic/claude-sonnet-4-6'

/**
 * Strips the `anthropic/` routing prefix used by AVAILABLE_MODELS (an
 * OpenRouter-style convention kept in the DB/dropdown for future
 * multi-provider support). The Anthropic Messages API expects bare model
 * ids (e.g. `claude-sonnet-4-6`), so this is the boundary conversion applied
 * right before the id is handed to `@ai-sdk/anthropic`'s provider factory.
 */
export function anthropicApiModelId(model: string): string {
  return model.startsWith('anthropic/') ? model.slice('anthropic/'.length) : model
}
