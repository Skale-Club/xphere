// Global, super-admin-curated knowledge base.
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
import { chunkText } from '@/lib/knowledge/chunk-text'

export const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1'
export const GLOBAL_KNOWLEDGE_EMBED_MODEL = 'text-embedding-3-small'

export type GlobalKnowledgePlatform = 'meta' | 'google' | 'global'

type EmbedCreds = { apiKey: string; baseURL?: string }

/**
 * Platform global OpenRouter key — used to embed the curated corpus on upload.
 * Charged to the platform owner. Returns null if the super admin hasn't set it.
 */
export async function getGlobalKnowledgeEmbeddingKey(): Promise<string | null> {
  const supabase = createServiceRoleClient()
  return getPlatformSetting('OPENROUTER_API_KEY', supabase)
}

/**
 * Resolve embedding credentials for an org querying Global Knowledge.
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

/**
 * Is this user the platform super admin? True if they're in platform_admins OR
 * their auth email matches PLATFORM_ADMIN_EMAIL. Used to gate Global Knowledge
 * writes coming through the (org-scoped) MCP endpoint.
 */
export async function isPlatformAdminUser(userId: string | null): Promise<boolean> {
  if (!userId) return false
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = createServiceRoleClient() as any

  const { data: adminRow } = await supabase
    .from('platform_admins')
    .select('user_id')
    .eq('user_id', userId)
    .maybeSingle()
  if (adminRow) return true

  const adminEmail = process.env.PLATFORM_ADMIN_EMAIL
  if (!adminEmail) return false
  try {
    const { data } = await supabase.auth.admin.getUserById(userId)
    return data?.user?.email?.toLowerCase() === adminEmail.toLowerCase()
  } catch {
    return false
  }
}

/**
 * Ingest text into Global Knowledge synchronously: create a source row, chunk,
 * embed with the platform OpenRouter key (platform-billed), and insert the
 * vector chunks tagged for global retrieval. For programmatic feeding (MCP).
 */
export async function ingestGlobalKnowledgeText(params: {
  name: string
  content: string
  platform: GlobalKnowledgePlatform
  createdBy?: string | null
}): Promise<{ source_id: string; chunk_count: number } | { error: string; detail?: string }> {
  const apiKey = await getGlobalKnowledgeEmbeddingKey()
  if (!apiKey) {
    return { error: 'no_platform_key', detail: 'Set the global OpenRouter key at /admin/settings/ai first.' }
  }
  if (!params.content.trim()) return { error: 'empty_content' }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = createServiceRoleClient() as any

  const { data: source, error: insertErr } = await supabase
    .from('global_knowledge_sources')
    .insert({
      platform: params.platform,
      name: params.name.trim() || 'Pasted text',
      source_type: 'text',
      source_url: null,
      status: 'processing',
      chunk_count: 0,
      created_by: params.createdBy ?? null,
    })
    .select('id')
    .single()
  if (insertErr || !source) return { error: 'insert_failed', detail: insertErr?.message }

  const chunks = chunkText(params.content, 500, 50)
  if (chunks.length === 0) {
    await supabase.from('global_knowledge_sources')
      .update({ status: 'error', error_detail: 'no chunks produced' }).eq('id', source.id)
    return { error: 'empty_content', detail: 'input produced zero chunks' }
  }

  try {
    const docRows: Array<{ content: string; embedding: number[]; metadata: Record<string, unknown> }> = []
    for (const chunk of chunks) {
      const vector = await embed(chunk, apiKey, {
        baseURL: OPENROUTER_BASE_URL,
        model: GLOBAL_KNOWLEDGE_EMBED_MODEL,
      })
      docRows.push({
        content: chunk,
        embedding: vector,
        metadata: {
          scope: 'global_knowledge',
          platform: params.platform,
          global_knowledge_source_id: source.id,
          source_name: params.name.trim(),
        },
      })
    }
    const { error: docErr } = await supabase.from('documents').insert(docRows)
    if (docErr) throw new Error(docErr.message)

    await supabase.from('global_knowledge_sources')
      .update({ status: 'ready', chunk_count: chunks.length, updated_at: new Date().toISOString() })
      .eq('id', source.id)

    return { source_id: source.id, chunk_count: chunks.length }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    await supabase.from('global_knowledge_sources')
      .update({ status: 'error', error_detail: msg }).eq('id', source.id)
    return { error: 'embedding_failed', detail: msg }
  }
}

export type GlobalKnowledgeMatch = {
  content: string
  platform: string | null
  source_name: string | null
  global_knowledge_source_id: string | null
  similarity: number | null
}

/**
 * Semantic search over Global Knowledge. Embeds the query with the org's
 * resolved credentials, then runs match_global_knowledge (a requested platform also
 * pulls in platform-agnostic 'global' fundamentals).
 */
export async function searchGlobalKnowledge(params: {
  orgId: string
  query: string
  platform?: 'meta' | 'google'
  topK?: number
}): Promise<{ matches: GlobalKnowledgeMatch[] } | { error: string; detail?: string }> {
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
      model: GLOBAL_KNOWLEDGE_EMBED_MODEL,
    })
  } catch (e) {
    return { error: 'embed_failed', detail: e instanceof Error ? e.message : String(e) }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = createServiceRoleClient() as any
  const { data, error } = await supabase.rpc('match_global_knowledge', {
    query_embedding: vector,
    platform_filter: params.platform ?? null,
    match_count: Math.min(params.topK ?? 5, 20),
  })
  if (error) return { error: 'search_failed', detail: error.message }

  type Row = { content: string; metadata: Record<string, unknown>; similarity?: number }
  const matches: GlobalKnowledgeMatch[] = (data as Row[] | null ?? []).map((m) => ({
    content: m.content,
    platform: (m.metadata?.platform as string | undefined) ?? null,
    source_name: (m.metadata?.source_name as string | undefined) ?? null,
    global_knowledge_source_id:
      (m.metadata?.global_knowledge_source_id as string | undefined) ?? null,
    similarity: m.similarity ?? null,
  }))
  return { matches }
}
