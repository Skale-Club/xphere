// Server actions for Global Knowledge (super-admin curated knowledge).
// Platform-level: no org scoping. Gated by the platform admin email, same as
// the (admin) layout. Embedding is billed to the platform OpenRouter key.
'use server'

import { getUser } from '@/lib/supabase/server'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { after } from 'next/server'
import { resolveNotionAccessToken } from '@/lib/notion/connection'
import { searchAccessibleNotionPages } from '@/lib/notion/client'
import {
  enqueueGlobalKnowledgeRootSync,
  processNextGlobalKnowledgeSyncJob,
} from '@/lib/knowledge/notion-sync'

export type GlobalKnowledgePlatform = 'meta' | 'google' | 'global'

async function assertPlatformAdmin(): Promise<{ userId: string }> {
  const user = await getUser()
  if (!user) redirect('/')
  if (user.email !== process.env.PLATFORM_ADMIN_EMAIL) redirect('/dashboard')
  return { userId: user.id }
}

export async function getGlobalKnowledgeSources() {
  await assertPlatformAdmin()
  const supabase = createServiceRoleClient()
  const { data, error } = await supabase
    .from('global_knowledge_sources')
    .select('*')
    .order('created_at', { ascending: false })
  if (error) throw new Error(error.message)
  return data ?? []
}

export async function hasPlatformOpenRouterKey(): Promise<boolean> {
  await assertPlatformAdmin()
  const supabase = createServiceRoleClient()
  const { data } = await supabase
    .from('platform_settings')
    .select('key')
    .eq('key', 'OPENROUTER_API_KEY')
    .maybeSingle()
  return !!data
}

/**
 * Register an uploaded Global Knowledge file and
 * kick off async embedding via the process-embeddings edge function.
 */
export async function insertGlobalKnowledgeSource(
  storagePath: string,
  fileName: string,
  sourceType: 'pdf' | 'text' | 'csv',
  platform: GlobalKnowledgePlatform,
): Promise<{ id: string }> {
  const { userId } = await assertPlatformAdmin()
  const supabase = createServiceRoleClient()

  const { data, error } = await supabase
    .from('global_knowledge_sources')
    .insert({
      platform,
      name: fileName,
      source_type: sourceType,
      source_url: storagePath,
      storage_bucket: 'global-knowledge',
      status: 'processing',
      created_by: userId,
    })
    .select('id')
    .single()

  if (error) throw new Error(error.message)

  void triggerGlobalKnowledgeJob(data.id, platform)
  return { id: data.id }
}

/**
 * Ingest pasted text (e.g. a course transcript) by writing it to the bucket as
 * a .txt file, then registering + embedding it like any other source.
 */
export async function addGlobalKnowledgeText(
  name: string,
  content: string,
  platform: GlobalKnowledgePlatform,
): Promise<{ id: string }> {
  const { userId } = await assertPlatformAdmin()
  if (!content.trim()) throw new Error('Empty content')
  const supabase = createServiceRoleClient()

  const storagePath = `${platform}/${crypto.randomUUID()}.txt`
  const { error: uploadErr } = await supabase.storage
    .from('global-knowledge')
    .upload(storagePath, new Blob([content], { type: 'text/plain' }), {
      contentType: 'text/plain',
      upsert: false,
    })
  if (uploadErr) throw new Error(`Storage upload failed: ${uploadErr.message}`)

  const { data, error } = await supabase
    .from('global_knowledge_sources')
    .insert({
      platform,
      name: name.trim() || 'Pasted text',
      source_type: 'text',
      source_url: storagePath,
      storage_bucket: 'global-knowledge',
      status: 'processing',
      created_by: userId,
    })
    .select('id')
    .single()
  if (error) throw new Error(error.message)

  void triggerGlobalKnowledgeJob(data.id, platform)
  return { id: data.id }
}

/**
 * Delete a Global Knowledge source, its vector chunks, storage file, and row.
 */
export async function deleteGlobalKnowledgeSource(sourceId: string): Promise<void> {
  await assertPlatformAdmin()
  const supabase = createServiceRoleClient()

  const { data: source } = await supabase
    .from('global_knowledge_sources')
    .select('source_url, storage_bucket, source_type')
    .eq('id', sourceId)
    .maybeSingle()
  if (source?.source_type === 'notion_page') {
    throw new Error('Delete this page in Notion or remove its synchronized root.')
  }

  // Remove vector chunks first (no FK cascade for global docs).
  await supabase.from('documents').delete().contains('metadata', { global_knowledge_source_id: sourceId })

  const { error: deleteError } = await supabase
    .from('global_knowledge_sources')
    .delete()
    .eq('id', sourceId)
  if (deleteError) throw new Error(deleteError.message)

  const typedSource = source as {
    source_url: string | null
    storage_bucket: string | null
  } | null
  const path = typedSource?.source_url
  if (path) {
    await supabase.storage.from(typedSource?.storage_bucket ?? 'global-knowledge').remove([path])
  }
}

export async function getGlobalKnowledgeNotionState() {
  await assertPlatformAdmin()
  const supabase = createServiceRoleClient()
  const [{ data: config }, { data: connection }] = await Promise.all([
    supabase.from('global_knowledge_config').select('source_mode').eq('id', 'primary').single(),
    supabase
      .from('global_knowledge_notion_connections')
      .select('id, workspace_id, workspace_name, workspace_icon, status, error_detail, last_synced_at, last_reconciled_at, created_at')
      .neq('status', 'disconnected')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])

  if (!connection) {
    return { sourceMode: config?.source_mode ?? 'manual', connection: null, roots: [], jobs: [] }
  }

  const [{ data: roots }, { data: jobs }] = await Promise.all([
    supabase
      .from('global_knowledge_notion_roots')
      .select('*')
      .eq('connection_id', connection.id)
      .order('created_at'),
    supabase
      .from('global_knowledge_sync_jobs')
      .select('id, root_id, job_type, status, attempts, error_detail, created_at, completed_at')
      .eq('connection_id', connection.id)
      .order('created_at', { ascending: false })
      .limit(10),
  ])

  return {
    sourceMode: config?.source_mode ?? 'manual',
    connection,
    roots: roots ?? [],
    jobs: jobs ?? [],
  }
}

export async function getAccessibleNotionPages() {
  await assertPlatformAdmin()
  const supabase = createServiceRoleClient()
  const { data: connection, error } = await supabase
    .from('global_knowledge_notion_connections')
    .select('id, encrypted_access_token, encrypted_refresh_token, token_expires_at')
    .neq('status', 'disconnected')
    .order('created_at', { ascending: false })
    .limit(1)
    .single()
  if (error || !connection) throw new Error('Connect Notion first')
  const accessToken = await resolveNotionAccessToken(connection)
  return searchAccessibleNotionPages(accessToken)
}

export async function addNotionKnowledgeRoot(
  pageId: string,
  title: string,
  platform: GlobalKnowledgePlatform,
): Promise<void> {
  await assertPlatformAdmin()
  if (!pageId || !title.trim()) throw new Error('Choose a Notion page')
  const supabase = createServiceRoleClient()
  const { data: connection } = await supabase
    .from('global_knowledge_notion_connections')
    .select('id')
    .neq('status', 'disconnected')
    .order('created_at', { ascending: false })
    .limit(1)
    .single()
  if (!connection) throw new Error('Connect Notion first')

  const { data: root, error } = await supabase
    .from('global_knowledge_notion_roots')
    .upsert({
      connection_id: connection.id,
      notion_page_id: pageId,
      title: title.trim(),
      platform,
      status: 'pending',
      error_detail: null,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'connection_id,notion_page_id' })
    .select('id')
    .single()
  if (error || !root) throw new Error(error?.message ?? 'Failed to save Notion root')

  await enqueueGlobalKnowledgeRootSync({
    connectionId: connection.id,
    rootId: root.id,
    jobType: 'initial',
  })
  after(() => processNextGlobalKnowledgeSyncJob())
  revalidatePath('/admin/knowledge')
}

export async function syncNotionKnowledgeRoot(rootId: string): Promise<void> {
  await assertPlatformAdmin()
  const supabase = createServiceRoleClient()
  const { data: root, error } = await supabase
    .from('global_knowledge_notion_roots')
    .select('id, connection_id')
    .eq('id', rootId)
    .single()
  if (error || !root) throw new Error('Notion root not found')
  await enqueueGlobalKnowledgeRootSync({
    connectionId: root.connection_id,
    rootId: root.id,
    jobType: 'reconcile',
  })
  after(() => processNextGlobalKnowledgeSyncJob())
  revalidatePath('/admin/knowledge')
}

export async function removeNotionKnowledgeRoot(rootId: string): Promise<void> {
  await assertPlatformAdmin()
  const supabase = createServiceRoleClient()
  const { data: sources } = await supabase
    .from('global_knowledge_sources')
    .select('id')
    .eq('notion_root_id', rootId)
  for (const source of sources ?? []) {
    await supabase
      .from('documents')
      .delete()
      .contains('metadata', { global_knowledge_source_id: source.id })
  }
  const { error } = await supabase
    .from('global_knowledge_notion_roots')
    .delete()
    .eq('id', rootId)
  if (error) throw new Error(error.message)
  const { count } = await supabase
    .from('global_knowledge_notion_roots')
    .select('id', { count: 'exact', head: true })
    .neq('status', 'disconnected')
  if ((count ?? 0) === 0) {
    const now = new Date().toISOString()
    await Promise.all([
      supabase
        .from('global_knowledge_config')
        .update({ source_mode: 'manual', updated_at: now })
        .eq('id', 'primary'),
      supabase
        .from('global_knowledge_sources')
        .update({ is_active: true, updated_at: now })
        .neq('source_type', 'notion_page'),
    ])
  }
  revalidatePath('/admin/knowledge')
}

export async function disconnectGlobalKnowledgeNotion(): Promise<void> {
  await assertPlatformAdmin()
  const supabase = createServiceRoleClient()
  const now = new Date().toISOString()
  await Promise.all([
    supabase
      .from('global_knowledge_config')
      .update({ source_mode: 'manual', updated_at: now })
      .eq('id', 'primary'),
    supabase
      .from('global_knowledge_notion_connections')
      .update({ status: 'disconnected', updated_at: now })
      .neq('status', 'disconnected'),
    supabase
      .from('global_knowledge_sources')
      .update({ is_active: false, updated_at: now })
      .eq('source_type', 'notion_page'),
    supabase
      .from('global_knowledge_sources')
      .update({ is_active: true, updated_at: now })
      .neq('source_type', 'notion_page'),
  ])
  revalidatePath('/admin/knowledge')
}

async function triggerGlobalKnowledgeJob(
  globalKnowledgeSourceId: string,
  platform: GlobalKnowledgePlatform,
): Promise<void> {
  const functionUrl = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/process-embeddings`
  try {
    const response = await fetch(functionUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      },
      // Keep the wire payload compatible with the currently deployed Edge
      // Function during the rolling rename. The new Function accepts both IDs.
      body: JSON.stringify({
        scope: 'ads_playbook',
        playbookSourceId: globalKnowledgeSourceId,
        globalKnowledgeSourceId,
        platform,
      }),
    })
    if (!response.ok) {
      console.error(`[global-knowledge] Edge Function returned ${response.status}`)
    }
  } catch (err) {
    console.error('[global-knowledge] Failed to trigger embedding job:', err)
  }
}
