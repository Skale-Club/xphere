/**
 * Hardcoded model dropdown for Phase 36. Mirrors the 7 entries seeded in
 * `agent_model_pricing` during Phase 33. Future: source from DB.
 */
export const AVAILABLE_MODELS = [
  'anthropic/claude-sonnet-4-6',
  'anthropic/claude-opus-4-7',
  'anthropic/claude-haiku-4-5',
  'openai/gpt-4o',
  'openai/gpt-4o-mini',
  'google/gemini-2.5-pro',
  'google/gemini-2.5-flash',
] as const

export type AvailableModel = (typeof AVAILABLE_MODELS)[number]
export const DEFAULT_MODEL: AvailableModel = 'anthropic/claude-sonnet-4-6'
