// src/lib/ads/playbook.ts
// Global, super-admin-curated ads knowledge base ("playbook"/fundamentals).
//
// Two cost levels, by design:
//   - INGESTION (super admin uploads a course): paid by the PLATFORM global
//     OpenRouter key (platform_settings.OPENROUTER_API_KEY, managed at
//     /admin/settings/ai). See the embedding pipeline (edge function / actions).
//   - QUERYING (an org's journey consults the fundamentals): paid by the ORG —
//     resolves the org's own key first, falling back to the platform key only
//     when the org has none (same fallback philosophy as the Copilot provider).
//
// All paths use text-embedding-3-small (1536-dim), so every vector — global or
// per-org — lives in the same space and is mutually comparable.

import { createServiceRoleClient } from '@/lib/supabase/admin'
import { getProviderKey } from '@/lib/integrations/get-provider-key'
import { getPlatformSetting } from '@/lib/platform-settings'
import { embed } from '@/lib/knowledge/embed'

export const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1'
export const PLAYBOOK_EMBED_MODEL = 'text-embedding-3-small'

export type PlaybookPlatform = 'meta' | 'google' | 'global'

type EmbedCreds = { apiKey: string; baseURL?: string }

/**
 * Platform global OpenRouter key — used to embed the curated corpus on upload.
 * Charged to the platform owner. Returns null if the super admin hasn't set it.
 */
export async function getPlatformOpenRouterKey(): Promise<string | null> {
  const supabase = createServiceRoleClient()
  return getPlatformSetting('OPENROUTER_API_KEY', supabase)
}

/**
 * Resolve embedding credentials for an ORG querying the global playbook.
 * Order: org OpenRouter (BYOK) → org OpenAI (BYOK) → platform OpenRouter.
 * The org spends its own credits whenever it has a key configured.
 */
export async function resolveOrgEmbedCreds(orgId: string): Promise<EmbedCreds | null> {
  const supabase = createServiceRoleClient()

  const orgOpenRouter = await getProviderKey('openrouter', orgId, supabase)
  if (orgOpenRouter) return { apiKey: orgOpenRouter, baseURL: OPENROUTER_BASE_URL }

  const orgOpenAI = await getProviderKey('openai', orgId, supabase)
  if (orgOpenAI) return { apiKey: orgOpenAI }

  const platformOpenRouter = await getPlatformSetting('OPENROUTER_API_KEY', supabase)
  if (platformOpenRouter) return { apiKey: platformOpenRouter, baseURL: OPENROUTER_BASE_URL }

  return null
}

export type PlaybookMatch = {
  content: string
  platform: string | null
  source_name: string | null
  playbook_source_id: string | null
  similarity: number | null
}

/**
 * Semantic search over the global ads playbook. Embeds the query with the org's
 * resolved credentials, then runs match_ads_playbook (a requested platform also
 * pulls in platform-agnostic 'global' fundamentals).
 */
export async function searchPlaybook(params: {
  orgId: string
  query: string
  platform?: 'meta' | 'google'
  topK?: number
}): Promise<{ matches: PlaybookMatch[] } | { error: string; detail?: string }> {
  const creds = await resolveOrgEmbedCreds(params.orgId)
  if (!creds) {
    return {
      error: 'no_embedding_key',
      detail:
        'No embedding key available — connect an OpenRouter/OpenAI key for this org, or set the platform OpenRouter key in /admin/settings/ai.',
    }
  }

  let vector: number[]
  try {
    vector = await embed(params.query.trim(), creds.apiKey, {
      baseURL: creds.baseURL,
      model: PLAYBOOK_EMBED_MODEL,
    })
  } catch (e) {
    return { error: 'embed_failed', detail: e instanceof Error ? e.message : String(e) }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = createServiceRoleClient() as any
  const { data, error } = await supabase.rpc('match_ads_playbook', {
    query_embedding: vector,
    platform_filter: params.platform ?? null,
    match_count: Math.min(params.topK ?? 5, 20),
  })
  if (error) return { error: 'search_failed', detail: error.message }

  type Row = { content: string; metadata: Record<string, unknown>; similarity?: number }
  const matches: PlaybookMatch[] = (data as Row[] | null ?? []).map((m) => ({
    content: m.content,
    platform: (m.metadata?.platform as string | undefined) ?? null,
    source_name: (m.metadata?.source_name as string | undefined) ?? null,
    playbook_source_id: (m.metadata?.playbook_source_id as string | undefined) ?? null,
    similarity: m.similarity ?? null,
  }))
  return { matches }
}
