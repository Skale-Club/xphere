// src/lib/knowledge/process-embeddings.ts
// Node port of supabase/functions/process-embeddings (Deno). Same payloads, same
// status transitions, same HTTP-style results; runs inside the app when
// EDGE_FUNCTIONS_IN_APP lists "process-embeddings" (see lib/edge-functions/switch).
//
// Differences from the Deno version, on purpose:
//  - embeddings go through lib/knowledge/embed.ts, not LangChain; same model
//    (text-embedding-3-small, 1536 dims) and the same `documents` row shape
//    ({ content, metadata, embedding }) that match_documents reads;
//  - chunking is lib/knowledge/recursive-split.ts (port of LangChain's splitter,
//    1000/100), minus the `loc.lines` metadata LangChain used to add;
//  - source_type 'url' is fetched with the SSRF-safe crawler fetch, because the
//    URL is user-supplied and the fetch now runs from the app host.
//
// The function does the whole job and returns when it is done. Callers that
// answer an HTTP request run it with runAfterResponse (Cloudflare cuts at 100s).

import type { SupabaseClient } from '@supabase/supabase-js'
import { decrypt as defaultDecrypt } from '@/lib/crypto'
import { embedBatch } from '@/lib/knowledge/embed'
import { recursiveSplitText } from '@/lib/knowledge/recursive-split'
import { isTrustedDownloadUrl } from '@/lib/edge-functions/trusted-download-url'

const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1'
const CHUNK_SIZE = 1000
const CHUNK_OVERLAP = 100
const EMBED_BATCH_SIZE = 512
const INSERT_BATCH_SIZE = 500
const DOWNLOAD_TIMEOUT_MS = 30_000

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any, any, any>

export interface EmbeddingJobPayload {
  /** Default (per-org knowledge_sources) job. */
  documentId?: string
  organizationId?: string
  /** Global Knowledge job. */
  scope?: 'global_knowledge' | 'ads_playbook'
  globalKnowledgeSourceId?: string
  playbookSourceId?: string
  platform?: 'meta' | 'google' | 'global'
  /** Presigned GET for the source file when its bucket lives on R2. */
  downloadUrl?: string
}

export interface JobResult {
  status: number
  body: Record<string, unknown>
}

export interface EmbeddingDeps {
  decrypt: (encrypted: string) => Promise<string>
  embedBatch: (texts: string[], apiKey: string, opts?: { baseURL?: string }) => Promise<number[][]>
  /** Reads a stored object (R2 or Supabase, whichever holds the bucket). */
  download: (bucket: string, path: string) => Promise<{ data: Blob | null; error: { message: string } | null }>
  /** Fetches a user-supplied URL; must be SSRF-safe. Returns the HTML. */
  fetchUrl: (url: string) => Promise<string>
  extractPdfText: (bytes: Uint8Array) => Promise<string>
  fetchSigned: (url: string, init: { signal: AbortSignal }) => Promise<Response>
  env: Record<string, string | undefined>
  now: () => string
}

function jsonResult(status: number, body: Record<string, unknown>): JobResult {
  return { status, body }
}

function defaultDeps(): EmbeddingDeps {
  return {
    decrypt: defaultDecrypt,
    embedBatch,
    download: async (bucket, path) => {
      const storage = await import('@/lib/storage')
      return storage.get(bucket as Parameters<typeof storage.get>[0], path)
    },
    fetchUrl: async (url) => {
      const { fetchPage } = await import('@/lib/seo/fetch-page')
      const res = await fetchPage(url, { timeoutMs: DOWNLOAD_TIMEOUT_MS })
      if (!res.ok) throw new Error(`URL fetch failed: ${res.error}`)
      if (res.status < 200 || res.status >= 300) throw new Error(`URL fetch failed: ${res.status}`)
      return res.body ?? ''
    },
    extractPdfText: async (bytes) => {
      const { extractText } = await import('unpdf')
      const { text } = await extractText(bytes, { mergePages: true })
      return text
    },
    fetchSigned: (url, init) => fetch(url, init),
    env: process.env,
    now: () => new Date().toISOString(),
  }
}

async function extractSourceText(
  deps: EmbeddingDeps,
  sourceType: string,
  sourceUrl: string | null,
  bucket: string,
  downloadUrl?: string | null,
): Promise<string> {
  if (sourceType === 'url' && sourceUrl) {
    const html = await deps.fetchUrl(sourceUrl)
    return html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  }

  if (sourceUrl) {
    let data: Blob | null = null
    // Why the signed download did not produce the file, for the error shown to the user.
    let signedFailure: string | null = null
    if (downloadUrl && isTrustedDownloadUrl(downloadUrl, deps.env)) {
      try {
        // A stuck request must fail, not hang the job in 'processing'.
        const res = await deps.fetchSigned(downloadUrl, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) })
        if (res.ok) data = await res.blob()
        else signedFailure = `signed URL returned HTTP ${res.status}`
      } catch (err) {
        signedFailure = `signed URL request failed (${err instanceof Error ? err.name : 'error'})`
      }
      if (signedFailure) console.warn(`[process-embeddings] ${signedFailure}; trying storage`)
    }
    if (!data) {
      const { data: blob, error } = await deps.download(bucket, sourceUrl)
      if (error || !blob) {
        throw new Error(
          `Source file could not be read: ${signedFailure ?? 'no signed download URL was provided'}, ` +
            `and it could not be read from storage (${error?.message ?? 'no data'}).`,
        )
      }
      data = blob
    }

    if (sourceType === 'pdf') {
      return deps.extractPdfText(new Uint8Array(await data.arrayBuffer()))
    }
    return await data.text()
  }

  throw new Error('No source URL available')
}

/** Embeds `chunks` and inserts them into `documents` with `metadata` on every row. */
async function embedAndStore(
  db: Db,
  deps: EmbeddingDeps,
  chunks: string[],
  metadata: Record<string, unknown>,
  apiKey: string,
  baseURL?: string,
): Promise<void> {
  // Embed everything first, then insert: a failed embedding call leaves no rows.
  const vectors: number[][] = []
  for (let i = 0; i < chunks.length; i += EMBED_BATCH_SIZE) {
    const batch = chunks.slice(i, i + EMBED_BATCH_SIZE)
    const out = await deps.embedBatch(batch, apiKey, baseURL ? { baseURL } : {})
    if (out.length !== batch.length) {
      throw new Error(`Embedding returned ${out.length} vectors for ${batch.length} chunks`)
    }
    vectors.push(...out)
  }

  const rows = chunks.map((content, i) => ({ content, embedding: vectors[i], metadata }))
  for (let i = 0; i < rows.length; i += INSERT_BATCH_SIZE) {
    const { error } = await db.from('documents').insert(rows.slice(i, i + INSERT_BATCH_SIZE))
    if (error) throw new Error(`Error inserting: ${error.message}`)
  }
}

async function processGlobalKnowledgeJob(
  db: Db,
  deps: EmbeddingDeps,
  sourceId: string,
  downloadUrl?: string | null,
): Promise<JobResult> {
  const { data: settingRow, error: settingErr } = await db
    .from('platform_settings')
    .select('encrypted_value')
    .eq('key', 'OPENROUTER_API_KEY')
    .maybeSingle()

  if (settingErr || !settingRow) {
    await db
      .from('global_knowledge_sources')
      .update({
        status: 'error',
        error_detail: 'Platform OPENROUTER_API_KEY not configured (set it at /admin/settings/ai)',
        updated_at: deps.now(),
      })
      .eq('id', sourceId)
    return jsonResult(400, { error: 'No platform OpenRouter key' })
  }

  let openRouterKey: string
  try {
    openRouterKey = await deps.decrypt((settingRow as { encrypted_value: string }).encrypted_value)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return jsonResult(500, { error: `Failed to decrypt platform key: ${msg}` })
  }

  const { data: source, error: sourceError } = await db
    .from('global_knowledge_sources')
    .select('id, platform, name, source_type, source_url, storage_bucket, status')
    .eq('id', sourceId)
    .single()

  if (sourceError || !source) return jsonResult(404, { error: 'Global Knowledge source not found' })

  const src = source as {
    id: string
    platform: string
    name: string
    source_type: string
    source_url: string | null
    storage_bucket: string | null
    status: string
  }
  if (src.status !== 'processing') return jsonResult(200, { skipped: true })

  try {
    const rawText = await extractSourceText(
      deps,
      src.source_type,
      src.source_url,
      src.storage_bucket ?? 'global-knowledge',
      downloadUrl,
    )
    if (!rawText.trim()) throw new Error('No text content extracted')

    const chunks = recursiveSplitText(rawText, CHUNK_SIZE, CHUNK_OVERLAP)
    if (chunks.length === 0) throw new Error('Text splitting produced no chunks')

    // No org_id: these chunks are global and queried via match_global_knowledge.
    await embedAndStore(
      db,
      deps,
      chunks,
      {
        scope: 'global_knowledge',
        platform: src.platform,
        global_knowledge_source_id: src.id,
        source_name: src.name,
      },
      openRouterKey,
      OPENROUTER_BASE_URL,
    )

    const { error: updateError } = await db
      .from('global_knowledge_sources')
      .update({ status: 'ready', chunk_count: chunks.length, updated_at: deps.now() })
      .eq('id', src.id)
    if (updateError) throw new Error(`Status update failed: ${updateError.message}`)

    return jsonResult(200, { success: true, chunkCount: chunks.length })
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err)
    await db
      .from('global_knowledge_sources')
      .update({ status: 'error', error_detail: errorMessage, updated_at: deps.now() })
      .eq('id', sourceId)
    console.error(`[process-embeddings] Global Knowledge job failed for ${sourceId}:`, errorMessage)
    return jsonResult(500, { error: errorMessage })
  }
}

export async function processEmbeddingJob(
  db: Db,
  payload: EmbeddingJobPayload,
  overrides: Partial<EmbeddingDeps> = {},
): Promise<JobResult> {
  const deps: EmbeddingDeps = { ...defaultDeps(), ...overrides }

  const secret = deps.env.ENCRYPTION_SECRET ?? ''
  if (!secret || secret.length !== 64) {
    return jsonResult(500, { error: 'ENCRYPTION_SECRET not configured' })
  }

  if (payload.scope === 'global_knowledge' || payload.scope === 'ads_playbook') {
    const sourceId = payload.globalKnowledgeSourceId ?? payload.playbookSourceId
    if (!sourceId) return jsonResult(400, { error: 'Missing globalKnowledgeSourceId' })
    return processGlobalKnowledgeJob(db, deps, sourceId, payload.downloadUrl)
  }

  const { documentId, organizationId } = payload
  if (!documentId || !organizationId) {
    return jsonResult(400, { error: 'Missing documentId or organizationId' })
  }

  const { data: integrationRow, error: integrationError } = await db
    .from('integrations')
    .select('encrypted_api_key')
    .eq('organization_id', organizationId)
    .eq('provider', 'openai')
    .eq('is_active', true)
    .limit(1)
    .single()

  if (integrationError || !integrationRow) {
    return jsonResult(400, { error: 'No active OpenAI integration found' })
  }

  let openaiApiKey: string
  try {
    openaiApiKey = await deps.decrypt((integrationRow as { encrypted_api_key: string }).encrypted_api_key)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return jsonResult(500, { error: `Failed to decrypt OpenAI key: ${msg}` })
  }

  const { data: source, error: sourceError } = await db
    .from('knowledge_sources')
    .select('id, organization_id, source_type, source_url, status')
    .eq('id', documentId)
    .eq('organization_id', organizationId)
    .single()

  if (sourceError || !source) return jsonResult(404, { error: 'Knowledge source not found' })

  const src = source as { source_type: string; source_url: string | null; status: string }
  // Idempotency: only a source still in 'processing' is worked on.
  if (src.status !== 'processing') return jsonResult(200, { skipped: true })

  try {
    const rawText = await extractSourceText(deps, src.source_type, src.source_url, 'knowledge-docs', payload.downloadUrl)
    if (!rawText.trim()) throw new Error('No text content extracted')

    const chunks = recursiveSplitText(rawText, CHUNK_SIZE, CHUNK_OVERLAP)
    if (chunks.length === 0) throw new Error('Text splitting produced no chunks')

    await embedAndStore(
      db,
      deps,
      chunks,
      {
        org_id: organizationId,
        source_id: documentId,
        source_type: src.source_type,
        knowledge_source_id: documentId,
      },
      openaiApiKey,
    )

    const { error: updateError } = await db
      .from('knowledge_sources')
      .update({ status: 'ready', chunk_count: chunks.length, updated_at: deps.now() })
      .eq('id', documentId)
    if (updateError) throw new Error(`Status update failed: ${updateError.message}`)

    return jsonResult(200, { success: true, chunkCount: chunks.length })
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err)
    await db
      .from('knowledge_sources')
      .update({ status: 'error', error_detail: errorMessage, updated_at: deps.now() })
      .eq('id', documentId)
    console.error(`[process-embeddings] Failed for source ${documentId}:`, errorMessage)
    return jsonResult(500, { error: errorMessage })
  }
}
