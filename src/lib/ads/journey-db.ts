import { createServiceRoleClient } from '@/lib/supabase/admin'
import type { Json } from '@/types/database'
import { embed, embedBatch } from '@/lib/knowledge/embed'
import { GLOBAL_KNOWLEDGE_EMBED_MODEL, resolveOrgEmbedCreds } from '@/lib/knowledge/global-knowledge'
import {
  KnowledgeRefInputSchema,
  normalizeKnowledgeRefs,
  parseStoredKnowledgeRefs,
  type KnowledgeRef,
  type KnowledgeRefInput,
} from '@/lib/knowledge/refs'

export type AdsMemoryType = 'insight' | 'decision' | 'plan' | 'risk' | 'observation' | 'result' | 'goal'
export type AdsMemoryStatus = 'active' | 'archived' | 'superseded' | 'needs_review'
export type AdsMemorySource = 'chat' | 'mcp' | 'manual' | 'audit'

export const ADS_MEMORY_STATUSES: readonly AdsMemoryStatus[] = ['active', 'archived', 'superseded', 'needs_review']

export type AdsMemory = {
  id: string
  org_id: string
  journey_id: string
  type: AdsMemoryType
  status: AdsMemoryStatus
  source: AdsMemorySource
  platform: 'meta' | 'google' | null
  title: string
  content: string
  campaign_id: string | null
  campaign_name: string | null
  confidence: number
  proposed: boolean
  metadata: Record<string, unknown>
  /** Global Knowledge sources that grounded this memory. */
  knowledge_refs: KnowledgeRef[]
  /** ads_change_requests row this memory is about, if any. */
  change_request_id: string | null
  /** The memory that replaced this one (status 'superseded'). */
  superseded_by: string | null
  /** null until the memory has been embedded for semantic search. */
  embedded_at: string | null
  created_at: string
  updated_at: string
}

/** Accepts tool input (optional fields) or already-normalized stored refs. */
export type KnowledgeRefsParam = ReadonlyArray<KnowledgeRefInput | KnowledgeRef>

/**
 * Every column except `embedding` — a 1536-float vector serialized as a
 * ~20KB string that no reader needs.
 */
export const ADS_MEMORY_COLUMNS =
  'id, org_id, journey_id, type, status, source, platform, title, content, campaign_id, campaign_name, confidence, proposed, metadata, knowledge_refs, change_request_id, superseded_by, embedded_at, created_at, updated_at'

function db() { return createServiceRoleClient() }

/** Map a raw ads_memories row (without embedding) to the typed shape. */
export function toAdsMemory(row: Record<string, unknown>): AdsMemory {
  return {
    ...(row as Omit<AdsMemory, 'knowledge_refs' | 'metadata' | 'change_request_id' | 'superseded_by' | 'embedded_at'>),
    metadata: (row.metadata && typeof row.metadata === 'object' ? row.metadata : {}) as Record<string, unknown>,
    knowledge_refs: parseStoredKnowledgeRefs(row.knowledge_refs),
    change_request_id: (row.change_request_id as string | null | undefined) ?? null,
    superseded_by: (row.superseded_by as string | null | undefined) ?? null,
    embedded_at: (row.embedded_at as string | null | undefined) ?? null,
  }
}

/**
 * Validate and normalize knowledge refs from either input shape. Invalid
 * entries (non-UUID source_id, malformed url) are dropped, never stored.
 */
export function coerceKnowledgeRefs(refs: KnowledgeRefsParam | null | undefined): KnowledgeRef[] {
  const valid: KnowledgeRefInput[] = []
  for (const ref of refs ?? []) {
    const parsed = KnowledgeRefInputSchema.safeParse({
      source_id: ref.source_id,
      ...(ref.source_name ? { source_name: ref.source_name } : {}),
      ...(ref.url ? { url: ref.url } : {}),
    })
    if (parsed.success) valid.push(parsed.data)
  }
  return normalizeKnowledgeRefs(valid).slice(0, 20)
}

/** The text a memory is embedded from — title carries most of the meaning. */
export function memoryEmbeddingText(title: string, content: string): string {
  return `${title.trim()}\n\n${content.trim()}`
}

type EmbedCreds = { apiKey: string; baseURL?: string }

/** supabase-js sends a number[] to a pgvector column; the generated type says string. */
function vectorColumn(vector: number[]): string {
  return vector as unknown as string
}

/**
 * Embed one memory and store the vector. Never throws: a memory that fails to
 * embed keeps embedding = null and backfillMemoryEmbeddings picks it up later.
 */
async function embedAndStoreMemory(
  orgId: string,
  memoryId: string,
  title: string,
  content: string,
  creds?: EmbedCreds | null,
): Promise<boolean> {
  try {
    const resolved = creds ?? (await resolveOrgEmbedCreds(orgId))
    if (!resolved) return false
    const vector = await embed(memoryEmbeddingText(title, content), resolved.apiKey, {
      baseURL: resolved.baseURL,
      model: GLOBAL_KNOWLEDGE_EMBED_MODEL,
    })
    const { error } = await db()
      .from('ads_memories')
      .update({ embedding: vectorColumn(vector), embedded_at: new Date().toISOString() })
      .eq('id', memoryId)
      .eq('org_id', orgId)
    if (error) throw new Error(error.message)
    return true
  } catch (err) {
    console.error('[ads/journey] failed to embed memory:', memoryId, err instanceof Error ? err.message : err)
    return false
  }
}

/** Is this ads_change_requests row in the org? Guards cross-org links. */
async function changeRequestBelongsToOrg(orgId: string, changeRequestId: string): Promise<boolean> {
  const { data } = await db()
    .from('ads_change_requests')
    .select('id')
    .eq('id', changeRequestId)
    .eq('org_id', orgId)
    .maybeSingle()
  return !!data
}

/**
 * One journey per org. Uses an upsert on the existing UNIQUE(org_id) rather
 * than select-then-insert: two concurrent callers (a Copilot tool and a
 * dashboard mutation landing together) would both read "no journey" and the
 * loser's insert would fail on the unique constraint.
 */
export async function getOrCreateJourney(orgId: string): Promise<{ id: string }> {
  const { data: existing } = await db()
    .from('ads_journey')
    .select('id')
    .eq('org_id', orgId)
    .maybeSingle()

  if (existing) return existing as { id: string }

  const { data: created, error } = await db()
    .from('ads_journey')
    .upsert({ org_id: orgId, title: 'Ads Journey' }, { onConflict: 'org_id' })
    .select('id')
    .single()

  if (created) return created as { id: string }

  // Lost a race after the upsert (or RLS rejected it) — re-read before failing.
  const { data: raced } = await db()
    .from('ads_journey')
    .select('id')
    .eq('org_id', orgId)
    .maybeSingle()
  if (raced) return raced as { id: string }

  throw new Error(`Failed to create journey: ${error?.message ?? 'unknown error'}`)
}

export async function fetchRecentMemories(
  orgId: string,
  platform?: 'meta' | 'google',
  limit = 10,
): Promise<AdsMemory[]> {
  let q = db()
    .from('ads_memories')
    .select(ADS_MEMORY_COLUMNS)
    .eq('org_id', orgId)
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(limit)

  if (platform) q = q.or(`platform.eq.${platform},platform.is.null`)

  const { data } = await q
  return ((data ?? []) as unknown as Record<string, unknown>[]).map(toAdsMemory)
}

/**
 * Insert a memory, then embed it for semantic search. Returns the new id, or
 * null when the row could not be saved. An embedding failure does NOT fail the
 * insert — the row keeps embedding = null and backfillMemoryEmbeddings (run
 * before every semantic search) catches it up.
 */
export async function createMemory(params: {
  orgId: string
  type: AdsMemoryType
  source: AdsMemorySource
  platform?: 'meta' | 'google'
  title: string
  content: string
  campaignId?: string
  campaignName?: string
  confidence?: number
  proposed?: boolean
  status?: AdsMemoryStatus
  metadata?: Record<string, unknown>
  /** Global Knowledge sources that grounded this memory. */
  knowledgeRefs?: KnowledgeRefsParam
  /** ads_change_requests row this memory is about; dropped if not in the org. */
  changeRequestId?: string
}): Promise<string | null> {
  try {
    const journey = await getOrCreateJourney(params.orgId)

    let changeRequestId: string | null = params.changeRequestId ?? null
    if (changeRequestId && !(await changeRequestBelongsToOrg(params.orgId, changeRequestId))) {
      console.warn('[ads/journey] ignoring change_request_id outside the org:', changeRequestId)
      changeRequestId = null
    }

    const { data, error } = await db()
      .from('ads_memories')
      .insert({
        org_id: params.orgId,
        journey_id: journey.id,
        type: params.type,
        status: params.status ?? (params.proposed ? 'needs_review' : 'active'),
        source: params.source,
        platform: params.platform ?? null,
        title: params.title,
        content: params.content,
        campaign_id: params.campaignId ?? null,
        campaign_name: params.campaignName ?? null,
        confidence: params.confidence ?? 3,
        proposed: params.proposed ?? false,
        metadata: (params.metadata ?? {}) as Json,
        knowledge_refs: coerceKnowledgeRefs(params.knowledgeRefs) as unknown as Json,
        change_request_id: changeRequestId,
      })
      .select('id')
      .single()

    if (error) {
      // Callers treat null as "not saved" and carry on, but a memory silently
      // failing to persist is exactly the kind of thing that goes unnoticed for
      // weeks — say so on the way out.
      console.error('[ads/journey] failed to create memory:', error.message)
      return null
    }
    const id = data?.id ?? null
    if (id) await embedAndStoreMemory(params.orgId, id, params.title, params.content)
    return id
  } catch (err) {
    console.error('[ads/journey] failed to create memory:', err instanceof Error ? err.message : err)
    return null
  }
}

export type UpdateMemoryError =
  | 'invalid_input'
  | 'not_found'
  | 'invalid_superseded_by'
  | 'no_changes'
  | 'update_failed'

export type UpdateMemoryResult =
  | { ok: true; memory: AdsMemory }
  | { ok: false; error: UpdateMemoryError; detail?: string }

/**
 * Curate an existing memory: approve (needs_review → active), archive,
 * supersede, edit the text or confidence, or replace its knowledge refs.
 * Always org-scoped.
 *
 * - `supersededBy` must be another memory of the same org; it forces status
 *   'superseded' (passing a different explicit status is an error).
 * - status 'active' also clears `proposed` (that IS the approval) and, like
 *   'needs_review', clears a stale `superseded_by` pointer.
 * - Changing title or content re-embeds; the old vector is cleared first so a
 *   failed re-embed leaves the row for backfill, never searchable by old text.
 */
export async function updateMemory(params: {
  orgId: string
  memoryId: string
  status?: AdsMemoryStatus
  title?: string
  content?: string
  confidence?: number
  supersededBy?: string
  knowledgeRefs?: KnowledgeRefsParam
}): Promise<UpdateMemoryResult> {
  const { orgId, memoryId } = params

  if (params.status !== undefined && !ADS_MEMORY_STATUSES.includes(params.status)) {
    return { ok: false, error: 'invalid_input', detail: `Unknown status "${params.status}".` }
  }
  const title = params.title?.trim()
  const content = params.content?.trim()
  if (params.title !== undefined && (!title || title.length > 200)) {
    return { ok: false, error: 'invalid_input', detail: 'title must be 1-200 characters.' }
  }
  if (params.content !== undefined && (!content || content.length > 2000)) {
    return { ok: false, error: 'invalid_input', detail: 'content must be 1-2000 characters.' }
  }
  if (
    params.confidence !== undefined &&
    (!Number.isInteger(params.confidence) || params.confidence < 1 || params.confidence > 5)
  ) {
    return { ok: false, error: 'invalid_input', detail: 'confidence must be an integer from 1 to 5.' }
  }
  if (params.supersededBy !== undefined && params.status !== undefined && params.status !== 'superseded') {
    return {
      ok: false,
      error: 'invalid_input',
      detail: `superseded_by implies status 'superseded'; got '${params.status}'.`,
    }
  }

  try {
    const { data: existingRow, error: readErr } = await db()
      .from('ads_memories')
      .select(ADS_MEMORY_COLUMNS)
      .eq('id', memoryId)
      .eq('org_id', orgId)
      .maybeSingle()
    if (readErr) return { ok: false, error: 'update_failed', detail: readErr.message }
    if (!existingRow) return { ok: false, error: 'not_found', detail: 'No memory with that id in this org.' }
    const existing = toAdsMemory(existingRow as unknown as Record<string, unknown>)

    const patch: Record<string, unknown> = {}

    if (params.supersededBy !== undefined) {
      if (params.supersededBy === memoryId) {
        return { ok: false, error: 'invalid_superseded_by', detail: 'A memory cannot supersede itself.' }
      }
      const { data: replacement } = await db()
        .from('ads_memories')
        .select('id, superseded_by')
        .eq('id', params.supersededBy)
        .eq('org_id', orgId)
        .maybeSingle()
      if (!replacement) {
        return { ok: false, error: 'invalid_superseded_by', detail: 'superseded_by must be a memory in the same org.' }
      }
      if (replacement.superseded_by === memoryId) {
        return {
          ok: false,
          error: 'invalid_superseded_by',
          detail: 'That memory is itself superseded by this one; supersession cannot be circular.',
        }
      }
      patch.superseded_by = params.supersededBy
      patch.status = 'superseded'
    } else if (params.status !== undefined) {
      patch.status = params.status
      if (params.status === 'active' || params.status === 'needs_review') patch.superseded_by = null
    }

    if (patch.status === 'active') patch.proposed = false

    const textChanged =
      (title !== undefined && title !== existing.title) || (content !== undefined && content !== existing.content)
    if (title !== undefined) patch.title = title
    if (content !== undefined) patch.content = content
    if (textChanged) {
      patch.embedding = null
      patch.embedded_at = null
    }
    if (params.confidence !== undefined) patch.confidence = params.confidence
    if (params.knowledgeRefs !== undefined) patch.knowledge_refs = coerceKnowledgeRefs(params.knowledgeRefs)

    if (Object.keys(patch).length === 0) {
      return { ok: false, error: 'no_changes', detail: 'Nothing to update.' }
    }
    patch.updated_at = new Date().toISOString()

    const { data: updatedRow, error: updateErr } = await db()
      .from('ads_memories')
      .update(patch as never)
      .eq('id', memoryId)
      .eq('org_id', orgId)
      .select(ADS_MEMORY_COLUMNS)
      .maybeSingle()
    if (updateErr) return { ok: false, error: 'update_failed', detail: updateErr.message }
    if (!updatedRow) return { ok: false, error: 'not_found', detail: 'No memory with that id in this org.' }
    let memory = toAdsMemory(updatedRow as unknown as Record<string, unknown>)

    if (textChanged && (await embedAndStoreMemory(orgId, memoryId, memory.title, memory.content))) {
      memory = { ...memory, embedded_at: new Date().toISOString() }
    }
    return { ok: true, memory }
  } catch (err) {
    return { ok: false, error: 'update_failed', detail: err instanceof Error ? err.message : String(err) }
  }
}

/**
 * Embed up to `limit` of the org's memories that have no vector yet (written
 * before migration 1325, or whose embed failed). Returns how many were stored.
 * Never throws.
 */
export async function backfillMemoryEmbeddings(orgId: string, limit = 25): Promise<number> {
  return backfillMemoryEmbeddingsWithCreds(orgId, undefined, limit)
}

/** Same as backfillMemoryEmbeddings, reusing already-resolved credentials. */
export async function backfillMemoryEmbeddingsWithCreds(
  orgId: string,
  creds: EmbedCreds | null | undefined,
  limit = 25,
): Promise<number> {
  try {
    const { data: rows, error } = await db()
      .from('ads_memories')
      .select('id, title, content')
      .eq('org_id', orgId)
      .is('embedding', null)
      .order('created_at', { ascending: false })
      .limit(Math.min(Math.max(1, Math.floor(limit)), 100))
    if (error) throw new Error(error.message)
    if (!rows || rows.length === 0) return 0

    const resolved = creds ?? (await resolveOrgEmbedCreds(orgId))
    if (!resolved) return 0

    const vectors = await embedBatch(
      rows.map((r) => memoryEmbeddingText(r.title, r.content)),
      resolved.apiKey,
      { baseURL: resolved.baseURL, model: GLOBAL_KNOWLEDGE_EMBED_MODEL },
    )
    const embeddedAt = new Date().toISOString()
    const results = await Promise.all(
      rows.map(async (row, i) => {
        const vector = vectors[i]
        if (!vector) return false
        const { error: updateErr } = await db()
          .from('ads_memories')
          .update({ embedding: vectorColumn(vector), embedded_at: embeddedAt })
          .eq('id', row.id)
          .eq('org_id', orgId)
        if (updateErr) console.error('[ads/journey] backfill update failed:', row.id, updateErr.message)
        return !updateErr
      }),
    )
    return results.filter(Boolean).length
  } catch (err) {
    console.error('[ads/journey] memory embedding backfill failed:', err instanceof Error ? err.message : err)
    return 0
  }
}

export type MutationToolName = 'pause_campaign' | 'enable_campaign' | 'set_daily_budget' | (string & {})

/**
 * Append an entry to the journey's execution log.
 *
 * This existed but was never wired to anything: campaigns paused and budgets
 * changed from the dashboard left no trace at all, so the journey's execution
 * timeline only ever showed what the AI claimed to have done. Every mutation
 * path now calls it with both the before and after values.
 *
 * Non-blocking by contract — a failure to write history must never fail the
 * mutation that already succeeded upstream.
 */
export async function recordMutationExecution(params: {
  toolName: MutationToolName
  orgId: string
  platform: 'meta' | 'google'
  campaignId?: string
  campaignName?: string
  beforeValue?: string | null
  afterValue?: string | null
  /** false for an operator acting in the dashboard, true for an AI tool call. */
  executedByAi?: boolean
  /** The acting user, when a human triggered it. */
  actorId?: string
  /** Explicit timeline title/type, for command-engine changes beyond pause/enable/budget. */
  title?: string
  executionType?: 'campaign_pause' | 'campaign_enable' | 'budget_increase' | 'budget_decrease' | 'audience_change' | 'creative_change' | 'manual'
  description?: string
  /** ads_change_requests row that produced this entry. */
  changeRequestId?: string
}): Promise<void> {
  try {
    const journey = await getOrCreateJourney(params.orgId)
    const name = params.campaignName

    let type: string
    let title: string

    switch (params.toolName) {
      case 'pause_campaign':
        type = 'campaign_pause'
        title = name ? `Campaign paused: ${name}` : 'Campaign paused'
        break
      case 'enable_campaign':
        type = 'campaign_enable'
        title = name ? `Campaign enabled: ${name}` : 'Campaign enabled'
        break
      case 'set_daily_budget': {
        // Direction matters for the timeline: "budget_increase" on a cut reads
        // as the opposite of what happened.
        const before = parseAmount(params.beforeValue)
        const after = parseAmount(params.afterValue)
        type = before != null && after != null && after < before ? 'budget_decrease' : 'budget_increase'
        const suffix = params.afterValue ? ` → ${params.afterValue}/day` : ''
        title = name ? `Budget updated: ${name}${suffix}` : `Budget updated${suffix}`
        break
      }
      default:
        type = 'manual'
        title = `Action executed: ${params.toolName}`
    }
    if (params.executionType) type = params.executionType
    if (params.title) title = params.title

    await db().from('ads_executions').insert({
      org_id: params.orgId,
      journey_id: journey.id,
      type,
      platform: params.platform,
      title,
      campaign_id: params.campaignId ?? null,
      campaign_name: params.campaignName ?? null,
      before_value: params.beforeValue ?? null,
      after_value: params.afterValue ?? null,
      executed_by_ai: params.executedByAi ?? false,
      executed_by: params.actorId ?? null,
      description: params.description ?? null,
      change_request_id: params.changeRequestId ?? null,
    })
  } catch (err) {
    // Non-blocking, but not invisible: a silently missing audit trail is how
    // this went unnoticed in the first place.
    console.error('[ads/journey] failed to record execution:', err instanceof Error ? err.message : err)
  }
}

/** Pull the numeric part out of a formatted money string ("R$ 1.234" → 1234). */
function parseAmount(value: string | null | undefined): number | null {
  if (!value) return null
  const digits = value.replace(/[^\d.,-]/g, '').replace(/\.(?=\d{3}\b)/g, '').replace(',', '.')
  const parsed = Number.parseFloat(digits)
  return Number.isFinite(parsed) ? parsed : null
}
