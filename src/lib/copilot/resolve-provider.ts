// Shared AI provider resolver for all AI features (copilot, workflow builder,
// knowledge synthesis, /api/email-templates/generate, AI email marketing, etc).
//
// OpenRouter is the platform default | one key covers Claude, GPT, Llama, etc.
// Platform-level keys are managed by the super admin under /admin/settings
// (encrypted in platform_settings table, never read from env).
//
// Resolution order:
//   1. Org-stored OpenRouter key       (org BYOK)
//   2. Platform OpenRouter key         (super admin, applies to all orgs)
//   3. Org-stored Anthropic key        (org BYOK, legacy/direct)
//   4. Platform Anthropic key          (super admin fallback)

import { createClient } from '@/lib/supabase/server'
import { getProviderKey } from '@/lib/integrations/get-provider-key'
import { getPlatformSetting } from '@/lib/platform-settings'

export type ProviderChoice =
  | { kind: 'openrouter'; apiKey: string; model: string }
  | { kind: 'anthropic';  apiKey: string; model: string }

// Default model per provider. Callers can override via the optional `model`
// param when they need a specific Haiku/Opus/etc.
export const DEFAULT_OPENROUTER_MODEL = 'anthropic/claude-sonnet-4.5'
export const DEFAULT_ANTHROPIC_MODEL  = 'claude-sonnet-4-6'

export async function resolveCopilotProvider(
  orgId: string,
  overrides?: { openrouterModel?: string; anthropicModel?: string },
): Promise<ProviderChoice | null> {
  const supabase = await createClient()

  const orModel = overrides?.openrouterModel ?? DEFAULT_OPENROUTER_MODEL
  const anModel = overrides?.anthropicModel ?? DEFAULT_ANTHROPIC_MODEL

  // 1. Org-level OpenRouter
  const orgOr = await getProviderKey('openrouter', orgId, supabase)
  if (orgOr) {
    return { kind: 'openrouter', apiKey: orgOr, model: orModel }
  }

  // 2. Platform-level OpenRouter (super admin → /admin/settings)
  const platformOr = await getPlatformSetting('OPENROUTER_API_KEY')
  if (platformOr) {
    return { kind: 'openrouter', apiKey: platformOr, model: orModel }
  }

  // 3. Org-level Anthropic
  const orgAnth = await getProviderKey('anthropic', orgId, supabase)
  if (orgAnth) {
    return { kind: 'anthropic', apiKey: orgAnth, model: anModel }
  }

  // 4. Platform-level Anthropic
  const platformAnth = await getPlatformSetting('ANTHROPIC_API_KEY')
  if (platformAnth) {
    return { kind: 'anthropic', apiKey: platformAnth, model: anModel }
  }

  return null
}

// Approximate token → USD cost. Numbers are rough; real spend tracking is
// best-effort at v1 (operator owns the key + the real invoice).
const PRICING_PER_MTOK_USD: Record<string, { input: number; output: number }> = {
  'claude-sonnet-4-6': { input: 3, output: 15 },
  'anthropic/claude-sonnet-4.5': { input: 3, output: 15 },
}

export function estimateCostUsd(
  model: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const rate = PRICING_PER_MTOK_USD[model] ?? { input: 3, output: 15 }
  const usd = (inputTokens * rate.input + outputTokens * rate.output) / 1_000_000
  return Math.round(usd * 10000) / 10000
}
