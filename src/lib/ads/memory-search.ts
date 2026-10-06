// Semantic search over an org's ads journey memories (migration 1325).
//
// Memories are embedded on write by createMemory/updateMemory with the same
// model and credentials as Global Knowledge (text-embedding-3-small, 1536-dim),
// so a query vector is comparable with both corpora.

import { createServiceRoleClient } from '@/lib/supabase/admin'
import { embed } from '@/lib/knowledge/embed'
import {
  GLOBAL_KNOWLEDGE_EMBED_MODEL,
  resolveOrgEmbedCreds,
  selectBySimilarity,
} from '@/lib/knowledge/global-knowledge'
import { parseStoredKnowledgeRefs, type KnowledgeRef } from '@/lib/knowledge/refs'
import {
  ADS_MEMORY_STATUSES,
  backfillMemoryEmbeddingsWithCreds,
  type AdsMemorySource,
  type AdsMemoryStatus,
  type AdsMemoryType,
} from '@/lib/ads/journey-db'

/**
 * Minimum cosine similarity for a memory to count as related to the query.
 *
 * Same embedding space as Global Knowledge, so the same calibration applies:
 * genuinely related ads text scores ~0.5-0.6 and shared-vocabulary noise
 * ~0.15-0.3. Every memory in an org is about the same business, which lifts
 * the noise floor slightly rather than lowering it, so there is no reason to
 * go below the Global Knowledge floor. Kept at 0.3 to favour recall: missing a
 * past decision that contradicts new advice is the costlier mistake here.
 */
export const ADS_MEMORY_MIN_SIMILARITY = 0.3

/** How many memories without a vector are embedded before each search. */
const SEARCH_BACKFILL_LIMIT = 25

export type AdsMemorySearchHit = {
  id: string
  type: AdsMemoryType
  status: AdsMemoryStatus
  source: AdsMemorySource
  platform: 'meta' | 'google' | null
  title: string
  content: string
  campaign_id: string | null
  campaign_name: string | null
  confidence: number
  knowledge_refs: KnowledgeRef[]
  change_request_id: string | null
  created_at: string
  similarity: number
}

export type AdsMemorySearchResult = {
  memories: AdsMemorySearchHit[]
  /** Candidates returned by the index that scored below min_similarity. */
  filtered_out: number
  min_similarity: number
  /** How many un-embedded memories were embedded before this search. */
  backfilled: number
}

type MatchRow = {
  id: string
  type: string
  status: string
  source: string
  platform: string | null
  title: string
  content: string
  campaign_id: string | null
  campaign_name: string | null
  confidence: number
  knowledge_refs: unknown
  change_request_id: string | null
  created_at: string
  similarity: number | null
}

/** Clamp the requested result count to the RPC's 1..50 range (default 10). */
export function memorySearchLimit(limit: number | undefined): number {
  const n = typeof limit === 'number' && Number.isFinite(limit) ? Math.floor(limit) : 10
  return Math.min(Math.max(1, n), 50)
}

/** Keep only known statuses; default to active memories. */
export function memorySearchStatuses(statuses: readonly string[] | undefined): AdsMemoryStatus[] {
  const valid = Array.from(new Set((statuses ?? []).filter((s): s is AdsMemoryStatus =>
    (ADS_MEMORY_STATUSES as readonly string[]).includes(s),
  )))
  return valid.length > 0 ? valid : ['active']
}

/**
 * Threshold + shape the RPC rows. Pure, so the cut is unit-tested; delegates
 * the selection rule to the same function Global Knowledge uses.
 */
export function selectMemoryMatches(
  rows: readonly MatchRow[],
  opts: { limit: number; minSimilarity: number },
): { memories: AdsMemorySearchHit[]; filteredOut: number } {
  const { kept, filteredOut } = selectBySimilarity(rows, opts)
  return {
    filteredOut,
    memories: kept.map((row) => ({
      id: row.id,
      type: row.type as AdsMemoryType,
      status: row.status as AdsMemoryStatus,
      source: row.source as AdsMemorySource,
      platform: row.platform === 'meta' || row.platform === 'google' ? row.platform : null,
      title: row.title,
      content: row.content,
      campaign_id: row.campaign_id,
      campaign_name: row.campaign_name,
      confidence: row.confidence,
      knowledge_refs: parseStoredKnowledgeRefs(row.knowledge_refs),
      change_request_id: row.change_request_id,
      created_at: row.created_at,
      similarity: row.similarity as number,
    })),
  }
}

/**
 * Search the org's memories by meaning. Embeds up to SEARCH_BACKFILL_LIMIT
 * memories that still lack a vector first, so rows written before the
 * embedding column existed (or whose embed failed) become findable.
 * A requested platform also returns platform-agnostic memories.
 */
export async function searchMemoriesSemantic(params: {
  orgId: string
  query: string
  platform?: 'meta' | 'google'
  statuses?: AdsMemoryStatus[]
  limit?: number
  minSimilarity?: number
}): Promise<AdsMemorySearchResult | { error: string; detail?: string }> {
  const query = params.query.trim()
  if (!query) return { error: 'empty_query', detail: 'Provide a non-empty query.' }

  const limit = memorySearchLimit(params.limit)
  const statuses = memorySearchStatuses(params.statuses)
  const minSimilarity =
    typeof params.minSimilarity === 'number' && Number.isFinite(params.minSimilarity)
      ? params.minSimilarity
      : ADS_MEMORY_MIN_SIMILARITY

  const creds = await resolveOrgEmbedCreds(params.orgId)
  if (!creds) {
    return {
      error: 'no_embedding_key',
      detail:
        'No embedding key available — connect an OpenRouter/OpenAI key for this org, or set the platform OpenRouter key in /admin/settings/ai.',
    }
  }

  const backfilled = await backfillMemoryEmbeddingsWithCreds(params.orgId, creds, SEARCH_BACKFILL_LIMIT)

  let vector: number[]
  try {
    vector = await embed(query, creds.apiKey, { baseURL: creds.baseURL, model: GLOBAL_KNOWLEDGE_EMBED_MODEL })
  } catch (e) {
    return { error: 'embed_failed', detail: e instanceof Error ? e.message : String(e) }
  }

  const { data, error } = await createServiceRoleClient().rpc('match_ads_memories', {
    p_org_id: params.orgId,
    query_embedding: vector,
    platform_filter: params.platform ?? null,
    status_filter: statuses,
    // Over-fetch so the similarity floor still leaves up to `limit` rows.
    match_count: Math.min(limit * 2, 50),
  })
  if (error) return { error: 'search_failed', detail: error.message }

  const { memories, filteredOut } = selectMemoryMatches((data ?? []) as MatchRow[], { limit, minSimilarity })
  return { memories, filtered_out: filteredOut, min_similarity: minSimilarity, backfilled }
}
