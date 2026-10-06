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
import { embed, embedBatch } from '@/lib/knowledge/embed'
import { chunkText } from '@/lib/knowledge/chunk-text'

export const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1'
export const GLOBAL_KNOWLEDGE_EMBED_MODEL = 'text-embedding-3-small'

/**
 * Minimum cosine similarity for a Global Knowledge passage to be returned.
 *
 * text-embedding-3-small compresses cosine scores into a narrow band: in
 * production, passages that genuinely answer an ads question score ~0.55-0.60,
 * while text that merely shares the ads vocabulary lands around 0.15-0.30.
 * Without a floor the RPC always hands back top_k rows, so an unrelated
 * question still "found" fundamentals and the AI cited them as grounding.
 *
 * 0.3 is deliberately conservative: it sits well under the relevant band (a
 * rephrased or multilingual question that scores 0.45 still passes) and only
 * cuts the off-topic tail. Raise it only with production evidence — a missed
 * citation is cheaper to notice than a confidently wrong one, but dropping a
 * real match silently is worse than both.
 */
export const GLOBAL_KNOWLEDGE_MIN_SIMILARITY = 0.3

/** Chunks per embeddings request when ingesting. */
const INGEST_EMBED_BATCH_SIZE = 32

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

export type GlobalKnowledgeSourceMode = 'manual' | 'notion'

/**
 * Which source family retrieval reads. In 'notion' mode only synchronized
 * Notion pages are searchable, so anything written as a manual source is
 * stored but invisible — writers must check this first.
 */
export async function getGlobalKnowledgeSourceMode(): Promise<GlobalKnowledgeSourceMode> {
  const supabase = createServiceRoleClient()
  const { data } = await supabase
    .from('global_knowledge_config')
    .select('source_mode')
    .eq('id', 'primary')
    .maybeSingle()
  return data?.source_mode === 'notion' ? 'notion' : 'manual'
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
 *
 * Only valid in 'manual' source mode. In 'notion' mode retrieval reads Notion
 * pages exclusively, so a manual source written here would be stored, billed
 * and never found — this returns `notion_mode` without writing anything and
 * the caller routes the content to a Notion page instead.
 *
 * Chunks are embedded INGEST_EMBED_BATCH_SIZE per request (one HTTP call per
 * chunk made a long course time out over MCP).
 */
export async function ingestGlobalKnowledgeText(params: {
  name: string
  content: string
  platform: GlobalKnowledgePlatform
  createdBy?: string | null
}): Promise<{ source_id: string; chunk_count: number } | { error: string; detail?: string }> {
  if (!params.content.trim()) return { error: 'empty_content' }

  const mode = await getGlobalKnowledgeSourceMode()
  if (mode === 'notion') {
    return {
      error: 'notion_mode',
      detail:
        'Global Knowledge is in Notion mode: retrieval only reads synchronized Notion pages, so text ingested as a manual source would never be searched. Nothing was written — create a Notion page under the Global Knowledge root instead.',
    }
  }

  const apiKey = await getGlobalKnowledgeEmbeddingKey()
  if (!apiKey) {
    return { error: 'no_platform_key', detail: 'Set the global OpenRouter key at /admin/settings/ai first.' }
  }

  const chunks = chunkText(params.content, 500, 50)
  if (chunks.length === 0) return { error: 'empty_content', detail: 'input produced zero chunks' }

  const sourceName = params.name.trim() || 'Pasted text'

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = createServiceRoleClient() as any

  const { data: source, error: insertErr } = await supabase
    .from('global_knowledge_sources')
    .insert({
      platform: params.platform,
      name: sourceName,
      source_type: 'text',
      source_url: null,
      status: 'processing',
      chunk_count: 0,
      created_by: params.createdBy ?? null,
    })
    .select('id')
    .single()
  if (insertErr || !source) return { error: 'insert_failed', detail: insertErr?.message }

  try {
    // Embed and insert batch by batch: one request per INGEST_EMBED_BATCH_SIZE
    // chunks, and no single multi-megabyte insert of every vector at once.
    for (const batch of batchItems(chunks, INGEST_EMBED_BATCH_SIZE)) {
      const vectors = await embedBatch(batch, apiKey, {
        baseURL: OPENROUTER_BASE_URL,
        model: GLOBAL_KNOWLEDGE_EMBED_MODEL,
      })
      if (vectors.length !== batch.length) {
        throw new Error(`embedding returned ${vectors.length} vectors for ${batch.length} chunks`)
      }
      const docRows = batch.map((chunk, i) => ({
        content: chunk,
        embedding: vectors[i],
        metadata: {
          scope: 'global_knowledge',
          platform: params.platform,
          global_knowledge_source_id: source.id,
          source_name: sourceName,
        },
      }))
      const { error: docErr } = await supabase.from('documents').insert(docRows)
      if (docErr) throw new Error(docErr.message)
    }

    await supabase.from('global_knowledge_sources')
      .update({ status: 'ready', chunk_count: chunks.length, updated_at: new Date().toISOString() })
      .eq('id', source.id)

    return { source_id: source.id, chunk_count: chunks.length }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    // Earlier batches may already be in `documents`; the source is 'error' so
    // retrieval ignores them, but don't leave orphaned vectors behind.
    await supabase.from('documents').delete().contains('metadata', { global_knowledge_source_id: source.id })
    await supabase.from('global_knowledge_sources')
      .update({ status: 'error', error_detail: msg }).eq('id', source.id)
    return { error: 'embedding_failed', detail: msg }
  }
}

/** Split into consecutive groups of at most `size` items. */
export function batchItems<T>(items: readonly T[], size: number): T[][] {
  const step = Math.max(1, Math.floor(size))
  const out: T[][] = []
  for (let i = 0; i < items.length; i += step) out.push(items.slice(i, i + step))
  return out
}

export type GlobalKnowledgeMatch = {
  content: string
  platform: string | null
  source_name: string | null
  /** Same value as global_knowledge_source_id; the name knowledge_refs use. */
  source_id: string | null
  /** @deprecated kept for existing callers — read source_id. */
  global_knowledge_source_id: string | null
  /** Link the operator can open to verify the citation (Notion page), else null. */
  url: string | null
  similarity: number | null
}

export type GlobalKnowledgeSearchResult = {
  matches: GlobalKnowledgeMatch[]
  /** Passages the RPC returned that scored below min_similarity. */
  filtered_out: number
  min_similarity: number
  /** Present when nothing relevant was found — tells the caller not to cite. */
  note?: string
}

/**
 * Keep rows at or above `minSimilarity`, best first, at most `limit`.
 * `filteredOut` counts only rows dropped for scoring too low — rows above the
 * floor that fall past `limit` are truncation, not filtering. A missing or
 * non-finite similarity never passes the floor.
 */
export function selectBySimilarity<T extends { similarity?: number | null }>(
  rows: readonly T[],
  opts: { limit: number; minSimilarity: number },
): { kept: T[]; filteredOut: number; bestSimilarity: number | null } {
  const limit = Math.max(0, Math.floor(opts.limit))
  const passing: T[] = []
  let filteredOut = 0
  let best: number | null = null
  for (const row of rows) {
    const score = row.similarity
    const finite = typeof score === 'number' && Number.isFinite(score)
    if (finite && (best === null || score > best)) best = score
    if (finite && score >= opts.minSimilarity) passing.push(row)
    else filteredOut++
  }
  passing.sort((a, b) => (b.similarity as number) - (a.similarity as number))
  return { kept: passing.slice(0, limit), filteredOut, bestSimilarity: best }
}

/**
 * The verifiable link for a source: only Notion pages carry one, and only an
 * http(s) URL is surfaced (never a storage path or a malformed value).
 */
export function resolveGlobalKnowledgeSourceUrl(source: {
  source_type: string | null | undefined
  source_url: string | null | undefined
} | null | undefined): string | null {
  if (!source || source.source_type !== 'notion_page' || !source.source_url) return null
  const raw = source.source_url.trim()
  try {
    const parsed = new URL(raw)
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? raw : null
  } catch {
    return null
  }
}

/** Over-fetch so the similarity floor still leaves up to topK passages. */
export function globalKnowledgeFetchCount(topK: number): number {
  return Math.min(Math.max(1, topK) * 2, 20)
}

/**
 * Semantic search over Global Knowledge. Embeds the query with the org's
 * resolved credentials, then runs match_global_knowledge (a requested platform also
 * pulls in platform-agnostic 'global' fundamentals).
 *
 * Passages scoring under `minSimilarity` (default GLOBAL_KNOWLEDGE_MIN_SIMILARITY)
 * are dropped; when none survive, `note` tells the caller not to cite Global
 * Knowledge for this question.
 */
export async function searchGlobalKnowledge(params: {
  orgId: string
  query: string
  platform?: 'meta' | 'google'
  topK?: number
  minSimilarity?: number
}): Promise<GlobalKnowledgeSearchResult | { error: string; detail?: string }> {
  const query = params.query.trim()
  if (!query) return { error: 'empty_query', detail: 'Provide a non-empty query.' }
  const requestedTopK = Number.isFinite(params.topK) ? Math.floor(params.topK as number) : 5
  const topK = Math.min(Math.max(1, requestedTopK), 20)
  const minSimilarity =
    typeof params.minSimilarity === 'number' && Number.isFinite(params.minSimilarity)
      ? params.minSimilarity
      : GLOBAL_KNOWLEDGE_MIN_SIMILARITY

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
    vector = await embed(query, creds.apiKey, {
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
    match_count: globalKnowledgeFetchCount(topK),
  })
  if (error) return { error: 'search_failed', detail: error.message }

  type Row = { content: string; metadata: Record<string, unknown> | null; similarity?: number | null }
  const { kept, filteredOut, bestSimilarity } = selectBySimilarity((data as Row[] | null) ?? [], {
    limit: topK,
    minSimilarity,
  })

  const sourceIdOf = (row: Row): string | null => {
    const meta = row.metadata ?? {}
    const id = meta.global_knowledge_source_id ?? meta.playbook_source_id
    return typeof id === 'string' && id ? id : null
  }

  // One batched lookup for the citation links, not one per match. A failure
  // here degrades to url: null rather than failing the search.
  const sourceIds = Array.from(new Set(kept.map(sourceIdOf).filter((id): id is string => !!id)))
  const sources = new Map<string, { name: string | null; url: string | null }>()
  if (sourceIds.length > 0) {
    const { data: sourceRows, error: sourceErr } = await supabase
      .from('global_knowledge_sources')
      .select('id, name, source_type, source_url')
      .in('id', sourceIds)
    if (sourceErr) {
      console.error('[global-knowledge] source link lookup failed:', sourceErr.message)
    }
    for (const s of (sourceRows ?? []) as Array<{
      id: string
      name: string | null
      source_type: string | null
      source_url: string | null
    }>) {
      sources.set(s.id, { name: s.name, url: resolveGlobalKnowledgeSourceUrl(s) })
    }
  }

  const matches: GlobalKnowledgeMatch[] = kept.map((m) => {
    const sourceId = sourceIdOf(m)
    const source = sourceId ? sources.get(sourceId) : undefined
    const metaName = m.metadata?.source_name
    return {
      content: m.content,
      platform: (m.metadata?.platform as string | undefined) ?? null,
      source_name: (typeof metaName === 'string' && metaName ? metaName : null) ?? source?.name ?? null,
      source_id: sourceId,
      global_knowledge_source_id: sourceId,
      url: source?.url ?? null,
      similarity: m.similarity ?? null,
    }
  })

  const result: GlobalKnowledgeSearchResult = {
    matches,
    filtered_out: filteredOut,
    min_similarity: minSimilarity,
  }
  if (matches.length === 0) {
    result.note = noRelevantKnowledgeNote(minSimilarity, bestSimilarity)
  }
  return result
}

function noRelevantKnowledgeNote(minSimilarity: number, best: number | null): string {
  const scored = best === null ? '' : ` (best passage scored ${best.toFixed(2)}, below the ${minSimilarity} relevance floor)`
  return (
    `No Global Knowledge passage is relevant to this question${scored}. ` +
    'Do not cite Global Knowledge for it — answer from the account data and say that no curated fundamental applies.'
  )
}

export type GlobalKnowledgeSourceSummary = {
  id: string
  platform: GlobalKnowledgePlatform
  name: string
  source_type: 'pdf' | 'text' | 'csv' | 'notion_page'
  status: 'processing' | 'ready' | 'error'
  error_detail: string | null
  chunk_count: number
  is_active: boolean
  source_url: string | null
  last_synced_at: string | null
  created_at: string
  /** Probably empty or a stub: at most one chunk, or never given a title. */
  thin: boolean
  /** Whether match_global_knowledge can return this source right now. */
  searchable: boolean
}

/**
 * Mirrors match_global_knowledge's source filter (migration 1220): ready,
 * active, and of the family the current source mode reads.
 */
export function classifyGlobalKnowledgeSource(
  source: Pick<GlobalKnowledgeSourceSummary, 'name' | 'chunk_count' | 'status' | 'is_active' | 'source_type'>,
  mode: GlobalKnowledgeSourceMode,
): { thin: boolean; searchable: boolean } {
  const thin = (source.chunk_count ?? 0) <= 1 || source.name.trim() === 'Untitled'
  const modeMatches = mode === 'notion' ? source.source_type === 'notion_page' : source.source_type !== 'notion_page'
  // An empty Notion page is synced with zero chunks: present, but never returned.
  const searchable = source.status === 'ready' && source.is_active === true && modeMatches && (source.chunk_count ?? 0) > 0
  return { thin, searchable }
}

/** All Global Knowledge sources with health flags, newest first. */
export async function listGlobalKnowledgeSources(params: {
  platform?: GlobalKnowledgePlatform
} = {}): Promise<
  | { source_mode: GlobalKnowledgeSourceMode; sources: GlobalKnowledgeSourceSummary[]; count: number }
  | { error: string; detail?: string }
> {
  const supabase = createServiceRoleClient()
  const mode = await getGlobalKnowledgeSourceMode()

  let q = supabase
    .from('global_knowledge_sources')
    .select('id, platform, name, source_type, status, error_detail, chunk_count, is_active, source_url, last_synced_at, created_at')
    .order('created_at', { ascending: false })
  if (params.platform) q = q.eq('platform', params.platform)

  const { data, error } = await q
  if (error) return { error: 'query_failed', detail: error.message }

  const sources: GlobalKnowledgeSourceSummary[] = (data ?? []).map((row) => {
    const base = row as Omit<GlobalKnowledgeSourceSummary, 'thin' | 'searchable'>
    return { ...base, ...classifyGlobalKnowledgeSource(base, mode) }
  })
  return { source_mode: mode, sources, count: sources.length }
}
