import { chunkText } from '@/lib/knowledge/chunk-text'
import { embedBatch } from '@/lib/knowledge/embed'
import {
  buildGlobalKnowledgeDocumentMetadata,
  hashNotionContent,
  normalizeNotionMarkdown,
  type GlobalKnowledgePlatform,
} from '@/lib/knowledge/notion-content'
import {
  getGlobalKnowledgeEmbeddingKey,
  OPENROUTER_BASE_URL,
  GLOBAL_KNOWLEDGE_EMBED_MODEL,
} from '@/lib/knowledge/global-knowledge'
import { resolveNotionAccessToken } from '@/lib/notion/connection'
import {
  NotionApiError,
  retrieveNotionBlockChildren,
  retrieveNotionPage,
  retrieveNotionPageMarkdown,
} from '@/lib/notion/client'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import type { Database } from '@/types/database'

type SyncJob = Database['public']['Tables']['global_knowledge_sync_jobs']['Row']
type Connection = Database['public']['Tables']['global_knowledge_notion_connections']['Row']
type Root = Database['public']['Tables']['global_knowledge_notion_roots']['Row']
type Source = Database['public']['Tables']['global_knowledge_sources']['Row']

const MAX_ROOT_PAGES = 500
const EMBEDDING_BATCH_SIZE = 32

function collectPlainText(value: unknown, output: string[]): void {
  if (Array.isArray(value)) {
    for (const item of value) collectPlainText(item, output)
    return
  }
  if (!value || typeof value !== 'object') return
  const record = value as Record<string, unknown>
  if (typeof record.plain_text === 'string' && record.plain_text.trim()) {
    output.push(record.plain_text.trim())
  }
  for (const [key, nested] of Object.entries(record)) {
    if (key !== 'plain_text') collectPlainText(nested, output)
  }
}

async function retrieveNotionPageTextFallback(
  accessToken: string,
  pageId: string,
): Promise<string> {
  const output: string[] = []
  const queue = [pageId]
  const visited = new Set<string>()
  while (queue.length > 0) {
    const blockId = queue.shift()!
    if (visited.has(blockId)) continue
    visited.add(blockId)
    const blocks = await retrieveNotionBlockChildren(accessToken, blockId)
    for (const block of blocks) {
      collectPlainText(block, output)
      if (block.has_children && block.type !== 'child_page') queue.push(block.id)
    }
  }
  return output.join('\n\n')
}

async function discoverChildPages(accessToken: string, pageId: string): Promise<string[]> {
  const childPages: string[] = []
  const blockQueue = [pageId]
  const visitedBlocks = new Set<string>()

  while (blockQueue.length > 0) {
    const blockId = blockQueue.shift()!
    if (visitedBlocks.has(blockId)) continue
    visitedBlocks.add(blockId)
    const blocks = await retrieveNotionBlockChildren(accessToken, blockId)
    for (const block of blocks) {
      if (block.type === 'child_page') {
        childPages.push(block.id)
      } else if (block.has_children) {
        blockQueue.push(block.id)
      }
    }
  }
  return childPages
}

async function embedChunks(chunks: string[], apiKey: string): Promise<number[][]> {
  const vectors: number[][] = []
  for (let index = 0; index < chunks.length; index += EMBEDDING_BATCH_SIZE) {
    const batch = chunks.slice(index, index + EMBEDDING_BATCH_SIZE)
    vectors.push(...await embedBatch(batch, apiKey, {
      baseURL: OPENROUTER_BASE_URL,
      model: GLOBAL_KNOWLEDGE_EMBED_MODEL,
    }))
  }
  return vectors
}

async function syncNotionPage(params: {
  accessToken: string
  root: Root
  pageId: string
  embeddingKey: string
}): Promise<void> {
  const supabase = createServiceRoleClient()
  const page = await retrieveNotionPage(params.accessToken, params.pageId)
  if (page.inTrash) {
    await supabase
      .from('global_knowledge_sources')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('external_id', params.pageId)
    return
  }

  const markdownResponse = await retrieveNotionPageMarkdown(params.accessToken, params.pageId)
  const markdown = markdownResponse.truncated || markdownResponse.unknown_block_ids.length > 0
    ? await retrieveNotionPageTextFallback(params.accessToken, params.pageId)
    : markdownResponse.markdown

  const content = normalizeNotionMarkdown(`# ${page.title}\n\n${markdown}`)
  const contentHash = await hashNotionContent(content)
  const { data: existing, error: existingError } = await supabase
    .from('global_knowledge_sources')
    .select('*')
    .eq('external_id', params.pageId)
    .maybeSingle()
  if (existingError) throw new Error(existingError.message)

  const current = existing as Source | null
  if (current?.content_hash === contentHash && current.active_revision_id) {
    const { error } = await supabase
      .from('global_knowledge_sources')
      .update({
        name: page.title,
        source_url: page.url,
        external_last_edited_at: page.lastEditedTime,
        last_synced_at: new Date().toISOString(),
        is_active: true,
        error_detail: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', current.id)
    if (error) throw new Error(error.message)
    return
  }

  let sourceId = current?.id
  if (!sourceId) {
    const { data: inserted, error } = await supabase
      .from('global_knowledge_sources')
      .insert({
        platform: params.root.platform,
        name: page.title,
        source_type: 'notion_page',
        source_url: page.url,
        status: 'processing',
        external_id: params.pageId,
        notion_root_id: params.root.id,
        is_active: false,
      })
      .select('id')
      .single()
    if (error || !inserted) throw new Error(error?.message ?? 'Failed to create Notion source')
    sourceId = inserted.id
  }

  const chunks = chunkText(content, 500, 50)
  if (chunks.length === 0) throw new Error(`Notion page ${params.pageId} produced no chunks`)

  const revisionId = crypto.randomUUID()
  try {
    const vectors = await embedChunks(chunks, params.embeddingKey)
    if (vectors.length !== chunks.length) throw new Error('Embedding response count mismatch')

    const rows = chunks.map((chunk, index) => ({
      content: chunk,
      embedding: vectors[index],
      metadata: buildGlobalKnowledgeDocumentMetadata({
        sourceId,
        revisionId,
        notionPageId: params.pageId,
        sourceName: page.title,
        platform: params.root.platform as GlobalKnowledgePlatform,
      }),
    }))
    const { error: insertError } = await supabase.from('documents').insert(rows)
    if (insertError) throw new Error(insertError.message)

    const { error: activationError } = await supabase.rpc(
      'activate_global_knowledge_revision',
      {
        p_source_id: sourceId,
        p_revision_id: revisionId,
        p_content_hash: contentHash,
        p_chunk_count: chunks.length,
        p_external_last_edited_at: page.lastEditedTime,
      },
    )
    if (activationError) throw new Error(activationError.message)

    // Cleanup is deliberately after activation. Failure leaves harmless,
    // non-active revisions that the retrieval RPC ignores.
    await supabase
      .from('documents')
      .delete()
      .contains('metadata', { global_knowledge_source_id: sourceId })
      .neq('metadata->>global_knowledge_revision_id', revisionId)
  } catch (error) {
    await supabase
      .from('global_knowledge_sources')
      .update({
        status: current?.active_revision_id ? 'ready' : 'error',
        error_detail: error instanceof Error ? error.message : String(error),
        updated_at: new Date().toISOString(),
      })
      .eq('id', sourceId)
    throw error
  }
}

async function syncNotionRoot(job: SyncJob, connection: Connection, root: Root): Promise<void> {
  const embeddingKey = await getGlobalKnowledgeEmbeddingKey()
  if (!embeddingKey) throw new Error('Platform OPENROUTER_API_KEY is not configured')
  const accessToken = await resolveNotionAccessToken(connection)
  const supabase = createServiceRoleClient()
  const pageQueue = [root.notion_page_id]
  const seen = new Set<string>()

  await supabase
    .from('global_knowledge_notion_roots')
    .update({ status: 'syncing', error_detail: null, updated_at: new Date().toISOString() })
    .eq('id', root.id)

  while (pageQueue.length > 0) {
    const pageId = pageQueue.shift()!
    if (seen.has(pageId)) continue
    if (seen.size >= MAX_ROOT_PAGES) {
      throw new Error(`Notion root exceeds the ${MAX_ROOT_PAGES}-page safety limit`)
    }
    seen.add(pageId)
    await syncNotionPage({ accessToken, root, pageId, embeddingKey })
    pageQueue.push(...await discoverChildPages(accessToken, pageId))
  }

  const { error } = await supabase.rpc('complete_global_knowledge_root_sync', {
    p_root_id: root.id,
    p_seen_external_ids: Array.from(seen),
  })
  if (error) throw new Error(error.message)
}

async function deleteNotionPage(pageId: string): Promise<void> {
  const supabase = createServiceRoleClient()
  const { data: source, error } = await supabase
    .from('global_knowledge_sources')
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq('external_id', pageId)
    .select('id')
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (source) {
    await supabase
      .from('documents')
      .delete()
      .contains('metadata', { global_knowledge_source_id: source.id })
  }
}

async function loadJobContext(job: SyncJob): Promise<{
  connection: Connection
  root: Root | null
}> {
  const supabase = createServiceRoleClient()
  const { data: connection, error: connectionError } = await supabase
    .from('global_knowledge_notion_connections')
    .select('*')
    .eq('id', job.connection_id)
    .single()
  if (connectionError || !connection) throw new Error('Notion connection not found')

  if (!job.root_id) return { connection: connection as Connection, root: null }
  const { data: root, error: rootError } = await supabase
    .from('global_knowledge_notion_roots')
    .select('*')
    .eq('id', job.root_id)
    .single()
  if (rootError || !root) throw new Error('Notion sync root not found')
  return { connection: connection as Connection, root: root as Root }
}

async function markJobFailure(job: SyncJob, error: unknown): Promise<void> {
  const supabase = createServiceRoleClient()
  const message = error instanceof Error ? error.message : String(error)
  const retryAfter = error instanceof NotionApiError ? error.retryAfterSeconds : null
  const shouldRetry = job.attempts < 8
  const delaySeconds = retryAfter ?? Math.min(60 * (2 ** Math.max(job.attempts - 1, 0)), 3600)
  await supabase
    .from('global_knowledge_sync_jobs')
    .update({
      status: shouldRetry ? 'queued' : 'failed',
      next_attempt_at: new Date(Date.now() + delaySeconds * 1000).toISOString(),
      error_detail: message.slice(0, 2000),
      completed_at: shouldRetry ? null : new Date().toISOString(),
    })
    .eq('id', job.id)

  if (job.root_id) {
    await supabase
      .from('global_knowledge_notion_roots')
      .update({ status: 'error', error_detail: message.slice(0, 2000) })
      .eq('id', job.root_id)
  }
  await supabase
    .from('global_knowledge_notion_connections')
    .update({ status: 'error', error_detail: message.slice(0, 2000) })
    .eq('id', job.connection_id)
}

export async function processNextGlobalKnowledgeSyncJob(): Promise<{
  claimed: boolean
  jobId?: string
}> {
  const supabase = createServiceRoleClient()
  const { data, error } = await supabase.rpc('claim_global_knowledge_sync_job')
  if (error) throw new Error(error.message)
  const job = (data?.[0] ?? null) as SyncJob | null
  if (!job) return { claimed: false }

  try {
    const { connection, root } = await loadJobContext(job)
    if (job.job_type === 'page_delete') {
      if (!job.notion_page_id) throw new Error('Delete job is missing notion_page_id')
      await deleteNotionPage(job.notion_page_id)
    } else {
      if (!root) throw new Error('Sync job is missing root_id')
      await syncNotionRoot(job, connection, root)
    }
    await supabase
      .from('global_knowledge_sync_jobs')
      .update({
        status: 'succeeded',
        completed_at: new Date().toISOString(),
        error_detail: null,
      })
      .eq('id', job.id)
    return { claimed: true, jobId: job.id }
  } catch (jobError) {
    await markJobFailure(job, jobError)
    return { claimed: true, jobId: job.id }
  }
}

export async function enqueueGlobalKnowledgeRootSync(params: {
  connectionId: string
  rootId: string
  jobType?: 'initial' | 'reconcile'
  eventId?: string
}): Promise<void> {
  const supabase = createServiceRoleClient()
  const { error } = await supabase.from('global_knowledge_sync_jobs').insert({
    connection_id: params.connectionId,
    root_id: params.rootId,
    job_type: params.jobType ?? 'reconcile',
    event_id: params.eventId ?? null,
  })
  if (error && error.code !== '23505') throw new Error(error.message)
}

export async function enqueueDueGlobalKnowledgeReconciliations(): Promise<number> {
  const supabase = createServiceRoleClient()
  const cutoff = new Date(Date.now() - 60 * 60 * 1000).toISOString()
  const { data: connections, error } = await supabase
    .from('global_knowledge_notion_connections')
    .select('id')
    .in('status', ['connected', 'error'])
    .or(`last_reconciled_at.is.null,last_reconciled_at.lt.${cutoff}`)
  if (error) throw new Error(error.message)

  let enqueued = 0
  const hourBucket = new Date().toISOString().slice(0, 13)
  for (const connection of connections ?? []) {
    const { data: roots } = await supabase
      .from('global_knowledge_notion_roots')
      .select('id')
      .eq('connection_id', connection.id)
      .neq('status', 'disconnected')
    for (const root of roots ?? []) {
      await enqueueGlobalKnowledgeRootSync({
        connectionId: connection.id,
        rootId: root.id,
        jobType: 'reconcile',
        eventId: `hourly:${root.id}:${hourBucket}`,
      })
      enqueued += 1
    }
  }
  return enqueued
}

export async function recoverStaleGlobalKnowledgeSyncJobs(): Promise<number> {
  const supabase = createServiceRoleClient()
  const cutoff = new Date(Date.now() - 15 * 60 * 1000).toISOString()
  const { data, error } = await supabase
    .from('global_knowledge_sync_jobs')
    .update({
      status: 'queued',
      next_attempt_at: new Date().toISOString(),
      error_detail: 'Recovered after worker lease expired',
      started_at: null,
    })
    .eq('status', 'processing')
    .lt('started_at', cutoff)
    .select('id')
  if (error) throw new Error(error.message)
  return data?.length ?? 0
}
