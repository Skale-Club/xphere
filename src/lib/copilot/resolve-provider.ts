// Shared BYOK resolver for the CRM copilot.
// Resolution order:
//   1. Org-stored OpenRouter key (preferred | multi-model, billed per org)
//   2. Org-stored Anthropic key
//   3. ANTHROPIC_API_KEY env var (dev fallback only)

import { createClient } from '@/lib/supabase/server'
import { getProviderKey } from '@/lib/integrations/get-provider-key'

export type ProviderChoice =
  | { kind: 'openrouter'; apiKey: string; model: string }
  | { kind: 'anthropic';  apiKey: string; model: string }

export async function resolveCopilotProvider(orgId: string): Promise<ProviderChoice | null> {
  const supabase = await createClient()

  const orKey = await getProviderKey('openrouter', orgId, supabase)
  if (orKey) {
    return {
      kind: 'openrouter',
      apiKey: orKey,
      model: 'anthropic/claude-sonnet-4.5',
    }
  }

  const anthKey = await getProviderKey('anthropic', orgId, supabase)
  if (anthKey) {
    return { kind: 'anthropic', apiKey: anthKey, model: 'claude-sonnet-4-6' }
  }

  const envKey = process.env.ANTHROPIC_API_KEY
  if (envKey) return { kind: 'anthropic', apiKey: envKey, model: 'claude-sonnet-4-6' }

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
