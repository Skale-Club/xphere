// supabase/functions/process-embeddings/index.ts
// Deno Edge Function: process knowledge source, embed via LangChain, store in pgvector
// Triggered via HTTP POST from knowledge.ts triggerEmbeddingJob()
// v1.1: LangChain SupabaseVectorStore + RecursiveCharacterTextSplitter
// v1.2: adds an 'ads_playbook' scope — the global, super-admin-curated ads
//       fundamentals corpus. It is platform-level (no org_id) and embedded with
//       the PLATFORM OpenRouter key, so ingestion is billed to the platform.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { SupabaseVectorStore } from 'https://esm.sh/@langchain/community@0.3.0/vectorstores/supabase'
import { OpenAIEmbeddings } from 'https://esm.sh/@langchain/openai@0.3.0'
import { RecursiveCharacterTextSplitter } from 'https://esm.sh/langchain@0.3.0/text_splitter'
import { Document } from 'https://esm.sh/@langchain/core@0.3.0/documents'
import { extractText as extractPdfText } from 'https://esm.sh/unpdf@1'

const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1'

interface JobPayload {
  // Default (per-org knowledge_sources) job:
  documentId?: string   // knowledge_sources.id
  organizationId?: string
  // Global ads-playbook job:
  scope?: 'ads_playbook'
  playbookSourceId?: string   // ads_playbook_sources.id
  platform?: 'meta' | 'google' | 'global'
}

// Decrypts a key encrypted by src/lib/crypto.ts (AES-256-GCM, format: ivBase64:ciphertextBase64)
async function decryptKey(encrypted: string, secret: string): Promise<string> {
  const colonIdx = encrypted.indexOf(':')
  if (colonIdx === -1) throw new Error('Invalid encrypted format')

  const iv = Uint8Array.from(atob(encrypted.slice(0, colonIdx)), (c) => c.charCodeAt(0))
  const ciphertext = Uint8Array.from(atob(encrypted.slice(colonIdx + 1)), (c) => c.charCodeAt(0))

  const keyBytes = new Uint8Array(32)
  for (let i = 0; i < 32; i++) {
    keyBytes[i] = parseInt(secret.slice(i * 2, i * 2 + 2), 16)
  }

  const cryptoKey = await crypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, ['decrypt'])
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, cryptoKey, ciphertext)
  return new TextDecoder().decode(plaintext)
}

async function extractText(
  supabase: ReturnType<typeof createClient>,
  sourceType: string,
  sourceUrl: string | null,
  bucket: string,
): Promise<string> {
  if (sourceType === 'url' && sourceUrl) {
    const response = await fetch(sourceUrl)
    if (!response.ok) throw new Error(`URL fetch failed: ${response.status}`)
    const html = await response.text()
    return html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  }

  if (sourceUrl) {
    const { data, error } = await supabase.storage.from(bucket).download(sourceUrl)
    if (error) throw new Error(`Storage download failed: ${error.message}`)

    if (sourceType === 'pdf') {
      const buffer = await data.arrayBuffer()
      const { text } = await extractPdfText(new Uint8Array(buffer), { mergePages: true })
      return text
    }

    return await data.text()
  }

  throw new Error('No source URL available')
}

// ─── Global ads-playbook job ──────────────────────────────────────────────────
async function processPlaybookJob(
  supabase: ReturnType<typeof createClient>,
  encryptionSecret: string,
  playbookSourceId: string,
): Promise<Response> {
  // 1) Platform OpenRouter key (billed to the platform owner)
  const { data: settingRow, error: settingErr } = await supabase
    .from('platform_settings')
    .select('encrypted_value')
    .eq('key', 'OPENROUTER_API_KEY')
    .maybeSingle()

  if (settingErr || !settingRow) {
    await supabase.from('ads_playbook_sources')
      .update({ status: 'error', error_detail: 'Platform OPENROUTER_API_KEY not configured (set it at /admin/settings/ai)', updated_at: new Date().toISOString() })
      .eq('id', playbookSourceId)
    return new Response(JSON.stringify({ error: 'No platform OpenRouter key' }), { status: 400 })
  }

  let openRouterKey: string
  try {
    openRouterKey = await decryptKey((settingRow as { encrypted_value: string }).encrypted_value, encryptionSecret)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return new Response(JSON.stringify({ error: `Failed to decrypt platform key: ${msg}` }), { status: 500 })
  }

  // 2) Source row
  const { data: source, error: sourceError } = await supabase
    .from('ads_playbook_sources')
    .select('id, platform, name, source_type, source_url, status')
    .eq('id', playbookSourceId)
    .single()

  if (sourceError || !source) {
    return new Response(JSON.stringify({ error: 'Playbook source not found' }), { status: 404 })
  }

  const src = source as { id: string; platform: string; name: string; source_type: string; source_url: string | null; status: string }
  if (src.status !== 'processing') {
    return new Response(JSON.stringify({ skipped: true }), { status: 200 })
  }

  try {
    const rawText = await extractText(supabase, src.source_type, src.source_url, 'ads-playbook')
    if (!rawText.trim()) throw new Error('No text content extracted')

    const splitter = new RecursiveCharacterTextSplitter({ chunkSize: 1000, chunkOverlap: 100 })
    const langchainDocs = await splitter.createDocuments(
      [rawText],
      [{ scope: 'ads_playbook', platform: src.platform, playbook_source_id: src.id, source_name: src.name }],
    )
    if (langchainDocs.length === 0) throw new Error('Text splitting produced no chunks')

    const docs = langchainDocs.map((doc) => new Document({
      pageContent: doc.pageContent,
      // No org_id: these chunks are global and queried via match_ads_playbook.
      metadata: { scope: 'ads_playbook', platform: src.platform, playbook_source_id: src.id, source_name: src.name },
    }))

    const embeddings = new OpenAIEmbeddings({
      apiKey: openRouterKey,
      model: 'text-embedding-3-small',
      configuration: { baseURL: OPENROUTER_BASE_URL },
    })

    await SupabaseVectorStore.fromDocuments(docs, embeddings, {
      client: supabase,
      tableName: 'documents',
      queryName: 'match_documents',
    })

    const { error: updateError } = await supabase
      .from('ads_playbook_sources')
      .update({ status: 'ready', chunk_count: docs.length, updated_at: new Date().toISOString() })
      .eq('id', src.id)
    if (updateError) throw new Error(`Status update failed: ${updateError.message}`)

    return new Response(JSON.stringify({ success: true, chunkCount: docs.length }), { status: 200 })
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err)
    await supabase
      .from('ads_playbook_sources')
      .update({ status: 'error', error_detail: errorMessage, updated_at: new Date().toISOString() })
      .eq('id', playbookSourceId)
    console.error(`[process-embeddings] Playbook job failed for ${playbookSourceId}:`, errorMessage)
    return new Response(JSON.stringify({ error: errorMessage }), { status: 500 })
  }
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 })
  }

  let payload: JobPayload
  try {
    payload = await req.json() as JobPayload
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), { status: 400 })
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  const encryptionSecret = Deno.env.get('ENCRYPTION_SECRET') ?? ''

  if (!encryptionSecret || encryptionSecret.length !== 64) {
    return new Response(JSON.stringify({ error: 'ENCRYPTION_SECRET not configured' }), { status: 500 })
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } })

  // ── Branch: global ads-playbook ingestion ──────────────────────────────────
  if (payload.scope === 'ads_playbook') {
    if (!payload.playbookSourceId) {
      return new Response(JSON.stringify({ error: 'Missing playbookSourceId' }), { status: 400 })
    }
    return await processPlaybookJob(supabase, encryptionSecret, payload.playbookSourceId)
  }

  // ── Default: per-org knowledge_sources ingestion ───────────────────────────
  const { documentId, organizationId } = payload
  if (!documentId || !organizationId) {
    return new Response(JSON.stringify({ error: 'Missing documentId or organizationId' }), { status: 400 })
  }

  // Fetch OpenAI API key from org integrations
  const { data: integrationRow, error: integrationError } = await supabase
    .from('integrations')
    .select('encrypted_api_key')
    .eq('organization_id', organizationId)
    .eq('provider', 'openai')
    .eq('is_active', true)
    .limit(1)
    .single()

  if (integrationError || !integrationRow) {
    return new Response(JSON.stringify({ error: 'No active OpenAI integration found' }), { status: 400 })
  }

  let openaiApiKey: string
  try {
    openaiApiKey = await decryptKey(integrationRow.encrypted_api_key, encryptionSecret)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return new Response(JSON.stringify({ error: `Failed to decrypt OpenAI key: ${msg}` }), { status: 500 })
  }

  // Fetch knowledge_sources row
  const { data: source, error: sourceError } = await supabase
    .from('knowledge_sources')
    .select('id, organization_id, source_type, source_url, status')
    .eq('id', documentId)
    .eq('organization_id', organizationId)
    .single()

  if (sourceError || !source) {
    return new Response(JSON.stringify({ error: 'Knowledge source not found' }), { status: 404 })
  }

  if (source.status !== 'processing') {
    return new Response(JSON.stringify({ skipped: true }), { status: 200 })
  }

  try {
    // Step 1: Extract raw text
    const rawText = await extractText(supabase, source.source_type, source.source_url, 'knowledge-docs')
    if (!rawText.trim()) throw new Error('No text content extracted')

    // Step 2: Split into chunks using LangChain RecursiveCharacterTextSplitter
    const splitter = new RecursiveCharacterTextSplitter({
      chunkSize: 1000,
      chunkOverlap: 100,
    })

    const langchainDocs = await splitter.createDocuments(
      [rawText],
      [{ org_id: organizationId, source_id: documentId, source_type: source.source_type }]
    )

    // Add knowledge_source_id to each doc metadata for FK linkage
    const docsWithSourceId = langchainDocs.map((doc) => new Document({
      pageContent: doc.pageContent,
      metadata: { ...doc.metadata, knowledge_source_id: documentId },
    }))

    if (docsWithSourceId.length === 0) throw new Error('Text splitting produced no chunks')

    // Step 3: Embed + store via LangChain SupabaseVectorStore
    const embeddings = new OpenAIEmbeddings({
      apiKey: openaiApiKey,
      model: 'text-embedding-3-small',
    })

    await SupabaseVectorStore.fromDocuments(docsWithSourceId, embeddings, {
      client: supabase,
      tableName: 'documents',
      queryName: 'match_documents',
    })

    // Step 4: Update knowledge_source status to ready
    const { error: updateError } = await supabase
      .from('knowledge_sources')
      .update({
        status: 'ready',
        chunk_count: docsWithSourceId.length,
        updated_at: new Date().toISOString(),
      })
      .eq('id', documentId)

    if (updateError) throw new Error(`Status update failed: ${updateError.message}`)

    return new Response(JSON.stringify({ success: true, chunkCount: docsWithSourceId.length }), { status: 200 })

  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err)

    await supabase
      .from('knowledge_sources')
      .update({ status: 'error', error_detail: errorMessage, updated_at: new Date().toISOString() })
      .eq('id', documentId)

    console.error(`[process-embeddings] Failed for source ${documentId}:`, errorMessage)
    return new Response(JSON.stringify({ error: errorMessage }), { status: 500 })
  }
})
