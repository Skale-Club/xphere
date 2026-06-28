// Server actions for the global ads playbook (super-admin curated knowledge).
// Platform-level: no org scoping. Gated by the platform admin email, same as
// the (admin) layout. Embedding is billed to the platform OpenRouter key.
'use server'

import { getUser } from '@/lib/supabase/server'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import { redirect } from 'next/navigation'

export type PlaybookPlatform = 'meta' | 'google' | 'global'

async function assertPlatformAdmin(): Promise<{ userId: string }> {
  const user = await getUser()
  if (!user) redirect('/')
  if (user.email !== process.env.PLATFORM_ADMIN_EMAIL) redirect('/dashboard')
  return { userId: user.id }
}

export async function getPlaybookSources() {
  await assertPlatformAdmin()
  const supabase = createServiceRoleClient()
  const { data, error } = await supabase
    .from('ads_playbook_sources')
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
 * Register an uploaded playbook file (already in the ads-playbook bucket) and
 * kick off async embedding via the process-embeddings edge function.
 */
export async function insertPlaybookSource(
  storagePath: string,
  fileName: string,
  sourceType: 'pdf' | 'text' | 'csv',
  platform: PlaybookPlatform,
): Promise<{ id: string }> {
  const { userId } = await assertPlatformAdmin()
  const supabase = createServiceRoleClient()

  const { data, error } = await supabase
    .from('ads_playbook_sources')
    .insert({
      platform,
      name: fileName,
      source_type: sourceType,
      source_url: storagePath,
      status: 'processing',
      created_by: userId,
    })
    .select('id')
    .single()

  if (error) throw new Error(error.message)

  void triggerPlaybookJob(data.id, platform)
  return { id: data.id }
}

/**
 * Ingest pasted text (e.g. a course transcript) by writing it to the bucket as
 * a .txt file, then registering + embedding it like any other source.
 */
export async function addPlaybookText(
  name: string,
  content: string,
  platform: PlaybookPlatform,
): Promise<{ id: string }> {
  const { userId } = await assertPlatformAdmin()
  if (!content.trim()) throw new Error('Empty content')
  const supabase = createServiceRoleClient()

  const storagePath = `${platform}/${crypto.randomUUID()}.txt`
  const { error: uploadErr } = await supabase.storage
    .from('ads-playbook')
    .upload(storagePath, new Blob([content], { type: 'text/plain' }), {
      contentType: 'text/plain',
      upsert: false,
    })
  if (uploadErr) throw new Error(`Storage upload failed: ${uploadErr.message}`)

  const { data, error } = await supabase
    .from('ads_playbook_sources')
    .insert({
      platform,
      name: name.trim() || 'Pasted text',
      source_type: 'text',
      source_url: storagePath,
      status: 'processing',
      created_by: userId,
    })
    .select('id')
    .single()
  if (error) throw new Error(error.message)

  void triggerPlaybookJob(data.id, platform)
  return { id: data.id }
}

/**
 * Delete a playbook source: its vector chunks (matched by metadata, since
 * playbook docs carry no knowledge_source_id FK), its storage file, and the row.
 */
export async function deletePlaybookSource(sourceId: string): Promise<void> {
  await assertPlatformAdmin()
  const supabase = createServiceRoleClient()

  const { data: source } = await supabase
    .from('ads_playbook_sources')
    .select('source_url')
    .eq('id', sourceId)
    .maybeSingle()

  // Remove vector chunks first (no FK cascade for global docs).
  await supabase.from('documents').delete().contains('metadata', { playbook_source_id: sourceId })

  const { error: deleteError } = await supabase
    .from('ads_playbook_sources')
    .delete()
    .eq('id', sourceId)
  if (deleteError) throw new Error(deleteError.message)

  const path = (source as { source_url: string | null } | null)?.source_url
  if (path) {
    await supabase.storage.from('ads-playbook').remove([path])
  }
}

async function triggerPlaybookJob(playbookSourceId: string, platform: PlaybookPlatform): Promise<void> {
  const functionUrl = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/process-embeddings`
  try {
    const response = await fetch(functionUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      },
      body: JSON.stringify({ scope: 'ads_playbook', playbookSourceId, platform }),
    })
    if (!response.ok) {
      console.error(`[ads-playbook] Edge Function returned ${response.status}`)
    }
  } catch (err) {
    console.error('[ads-playbook] Failed to trigger embedding job:', err)
  }
}
