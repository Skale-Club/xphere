// Write path for Global Knowledge while it runs in 'notion' source mode.
//
// In 'notion' mode only synchronized Notion pages are searchable, so new
// knowledge must land in Notion itself: we create a real child page under a
// synchronized root and enqueue a reconcile of that root. The normal sync
// (notion-sync.ts) then reads it back, hashes, chunks and embeds it like any
// page an operator wrote by hand — Notion stays the single source of truth.
//
// Processing is deliberately NOT done inline: callers schedule
// `processNextGlobalKnowledgeSyncJob()` (e.g. via `after()`), because a root
// reconcile can take minutes.

import { createServiceRoleClient } from '@/lib/supabase/admin'
import { resolveNotionAccessToken } from '@/lib/notion/connection'
import {
  appendNotionPageMarkdown,
  createNotionPageFromMarkdown,
  NotionApiError,
} from '@/lib/notion/client'
import { enqueueGlobalKnowledgeRootSync } from '@/lib/knowledge/notion-sync'

export type GlobalKnowledgeNotionPlatform = 'meta' | 'google' | 'global'

export type GlobalKnowledgeNotionRoot = {
  id: string
  title: string
  platform: string
  status: string
  notion_page_id: string
}

export type CreateGlobalKnowledgeNotionPageResult =
  | { ok: true; pageId: string; url: string | null; rootId: string; rootTitle: string }
  | { ok: false; error: string; detail?: string }

/** Notion page titles are rich text capped at 2000 chars; keep them readable. */
export const MAX_NOTION_TITLE_CHARS = 200
/** Markdown per request. Notion rejects "excessively large" bodies without a documented size, so stay well under. */
export const NOTION_MARKDOWN_SEGMENT_CHARS = 40_000
/** Overall cap for one knowledge page (~ a long course transcript). */
export const MAX_NOTION_PAGE_MARKDOWN_CHARS = 400_000

const INSERT_CAPABILITY_DETAIL =
  'The Notion integration needs the "Insert content" capability. Enable it for the Xphere integration ' +
  'in Notion (Settings → Connections / developer portal → Capabilities), re-authorize via "Manage access" ' +
  'if prompted, and make sure the root page is shared with the integration.'

// ---------------------------------------------------------------------------
// Pure helpers (unit tested)
// ---------------------------------------------------------------------------

/** Normalize a page title: single line, trimmed, capped. */
export function normalizeNotionPageTitle(title: string): string {
  const flat = title.replace(/\s+/g, ' ').trim()
  return flat.length > MAX_NOTION_TITLE_CHARS
    ? `${flat.slice(0, MAX_NOTION_TITLE_CHARS - 1).trimEnd()}…`
    : flat
}

/**
 * Body Markdown for a new knowledge page:
 *  - CRLF → LF, trailing spaces trimmed;
 *  - a leading `# <title>` H1 that repeats the page title is dropped (the
 *    title lives in the page property and the sync re-adds it as the H1);
 *  - with `sourceUrl`, a `Source: <url>` line is put at the top so the
 *    provenance survives into every embedded revision.
 */
export function buildGlobalKnowledgePageMarkdown(params: {
  title: string
  markdown: string
  sourceUrl?: string | null
}): string {
  let body = params.markdown
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .trim()

  const firstLine = body.split('\n', 1)[0] ?? ''
  const h1 = /^#\s+(.+)$/.exec(firstLine)
  if (h1 && h1[1].trim().toLowerCase() === normalizeNotionPageTitle(params.title).toLowerCase()) {
    body = body.slice(firstLine.length).trim()
  }

  const source = params.sourceUrl?.trim()
  if (source) {
    // Percent-encode characters that would break the Markdown link target.
    // (encodeURIComponent leaves parentheses alone, so encode by code point.)
    const href = source.replace(
      /[()\s<>]/g,
      (char) => `%${char.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`,
    )
    body = `Source: [${source}](${href})\n\n${body}`.trim()
  }
  return body
}

/**
 * Split Markdown into request-sized segments at blank-line boundaries,
 * never inside a fenced code block unless a single block is itself larger
 * than `maxChars` (then it is hard-split at line, then character, bounds).
 */
export function splitMarkdownSegments(markdown: string, maxChars = NOTION_MARKDOWN_SEGMENT_CHARS): string[] {
  const text = markdown.trim()
  if (!text) return []
  if (text.length <= maxChars) return [text]

  // 1. Group lines into blocks separated by blank lines outside code fences.
  const blocks: string[] = []
  let current: string[] = []
  let inFence = false
  for (const line of text.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence
    if (!inFence && line.trim() === '') {
      if (current.length > 0) blocks.push(current.join('\n'))
      current = []
      continue
    }
    current.push(line)
  }
  if (current.length > 0) blocks.push(current.join('\n'))

  // 2. Break any oversized block down to pieces that fit.
  const pieces: string[] = []
  for (const block of blocks) {
    if (block.length <= maxChars) {
      pieces.push(block)
      continue
    }
    let buffer = ''
    for (const line of block.split('\n')) {
      if (line.length > maxChars) {
        if (buffer) pieces.push(buffer)
        buffer = ''
        for (let index = 0; index < line.length; index += maxChars) {
          pieces.push(line.slice(index, index + maxChars))
        }
        continue
      }
      const next = buffer ? `${buffer}\n${line}` : line
      if (next.length > maxChars) {
        pieces.push(buffer)
        buffer = line
      } else {
        buffer = next
      }
    }
    if (buffer) pieces.push(buffer)
  }

  // 3. Pack pieces greedily into segments joined by blank lines.
  const segments: string[] = []
  let segment = ''
  for (const piece of pieces) {
    const next = segment ? `${segment}\n\n${piece}` : piece
    if (next.length > maxChars && segment) {
      segments.push(segment)
      segment = piece
    } else {
      segment = next
    }
  }
  if (segment) segments.push(segment)
  return segments
}

/**
 * Root selection: explicit rootId (must exist and not be disconnected) →
 * a root whose platform matches → the 'global' root → 'no_root'.
 */
export function selectGlobalKnowledgeRoot<T extends { id: string; platform: string; status: string }>(
  roots: T[],
  params: { rootId?: string | null; platform?: string | null },
): { ok: true; root: T } | { ok: false; error: 'root_not_found' | 'no_root'; detail: string } {
  const usable = roots.filter((root) => root.status !== 'disconnected')
  if (params.rootId) {
    const root = usable.find((candidate) => candidate.id === params.rootId)
    return root
      ? { ok: true, root }
      : { ok: false, error: 'root_not_found', detail: `No synchronized Notion root with id ${params.rootId}.` }
  }
  const byPlatform = params.platform
    ? usable.find((root) => root.platform === params.platform)
    : undefined
  const fallback = byPlatform ?? usable.find((root) => root.platform === 'global')
  return fallback
    ? { ok: true, root: fallback }
    : {
        ok: false,
        error: 'no_root',
        detail: 'Add a synchronized Notion root (Admin → Global Knowledge → Sync from Notion) before writing knowledge.',
      }
}

/** Map a Notion write failure to a stable, operator-readable error. */
export function describeNotionWriteError(error: unknown): { error: string; detail: string } {
  if (error instanceof NotionApiError) {
    if (error.status === 403 || error.code === 'restricted_resource') {
      return { error: 'notion_insert_capability_missing', detail: INSERT_CAPABILITY_DETAIL }
    }
    if (error.status === 404 || error.code === 'object_not_found') {
      return {
        error: 'notion_root_not_accessible',
        detail: 'Notion could not find the root page. Make sure it is still shared with the Xphere integration.',
      }
    }
    if (error.status === 401) {
      return { error: 'notion_unauthorized', detail: 'The Notion token was rejected. Reconnect Notion.' }
    }
    if (error.status === 429) {
      return { error: 'notion_rate_limited', detail: 'Notion rate limit hit. Try again in a minute.' }
    }
    return { error: 'notion_request_failed', detail: error.message.slice(0, 500) }
  }
  return { error: 'notion_request_failed', detail: error instanceof Error ? error.message : String(error) }
}

// ---------------------------------------------------------------------------
// Data access
// ---------------------------------------------------------------------------

/** Synchronized roots that can receive new pages (not disconnected), oldest first. */
export async function listGlobalKnowledgeNotionRoots(): Promise<GlobalKnowledgeNotionRoot[]> {
  const supabase = createServiceRoleClient()
  const { data: connections } = await supabase
    .from('global_knowledge_notion_connections')
    .select('id')
    .not('status', 'in', '(disconnected,revoked)')
  const connectionIds = (connections ?? []).map((connection) => connection.id)
  if (connectionIds.length === 0) return []

  const { data, error } = await supabase
    .from('global_knowledge_notion_roots')
    .select('id, title, platform, status, notion_page_id')
    .in('connection_id', connectionIds)
    .neq('status', 'disconnected')
    .order('created_at')
  if (error) throw new Error(error.message)
  return (data ?? []) as GlobalKnowledgeNotionRoot[]
}

/**
 * Create a Notion page under a synchronized Global Knowledge root and enqueue
 * a reconcile of that root so the page is embedded by the normal sync.
 */
export async function createGlobalKnowledgeNotionPage(params: {
  title: string
  markdown: string
  platform?: 'meta' | 'google' | 'global'
  rootId?: string
  sourceUrl?: string
  createdBy?: string | null
}): Promise<
  | { ok: true; pageId: string; url: string | null; rootId: string; rootTitle: string }
  | { ok: false; error: string; detail?: string }
> {
  const title = normalizeNotionPageTitle(params.title ?? '')
  if (!title) return { ok: false, error: 'missing_title', detail: 'A page title is required.' }

  const body = buildGlobalKnowledgePageMarkdown({
    title,
    markdown: params.markdown ?? '',
    sourceUrl: params.sourceUrl,
  })
  if (!body) return { ok: false, error: 'empty_content', detail: 'The page content is empty.' }
  if (body.length > MAX_NOTION_PAGE_MARKDOWN_CHARS) {
    return {
      ok: false,
      error: 'content_too_large',
      detail: `Content is ${body.length} characters; the limit is ${MAX_NOTION_PAGE_MARKDOWN_CHARS}. Split it into several pages.`,
    }
  }

  const supabase = createServiceRoleClient()
  const { data: roots, error: rootsError } = await supabase
    .from('global_knowledge_notion_roots')
    .select('id, connection_id, title, platform, status, notion_page_id, created_at')
    .neq('status', 'disconnected')
    .order('created_at')
  if (rootsError) return { ok: false, error: 'lookup_failed', detail: rootsError.message }

  const selection = selectGlobalKnowledgeRoot(roots ?? [], {
    rootId: params.rootId,
    platform: params.platform,
  })
  if (!selection.ok) return { ok: false, error: selection.error, detail: selection.detail }
  const root = selection.root

  const { data: connection } = await supabase
    .from('global_knowledge_notion_connections')
    .select('id, status, encrypted_access_token, encrypted_refresh_token, token_expires_at')
    .eq('id', root.connection_id)
    .maybeSingle()
  if (!connection || connection.status === 'disconnected' || connection.status === 'revoked') {
    return {
      ok: false,
      error: 'notion_not_connected',
      detail: 'The Notion connection for this root is not active. Reconnect Notion first.',
    }
  }

  let pageId: string
  let url: string | null
  try {
    const accessToken = await resolveNotionAccessToken(connection)
    const [first, ...rest] = splitMarkdownSegments(body)
    const page = await createNotionPageFromMarkdown(accessToken, {
      parentPageId: root.notion_page_id,
      title,
      markdown: first,
    })
    pageId = page.id
    url = page.url
    for (const segment of rest) {
      await appendNotionPageMarkdown(accessToken, page.id, segment)
    }
  } catch (error) {
    return { ok: false, ...describeNotionWriteError(error) }
  }

  // Placeholder source row so the page shows up as "Processing" in the admin
  // UI right away and keeps who created it. The sync finds it by external_id
  // and fills in the revision. A unique-violation (sync got there first) is fine.
  const { error: placeholderError } = await supabase.from('global_knowledge_sources').insert({
    platform: root.platform,
    name: title,
    source_type: 'notion_page',
    source_url: url,
    status: 'processing',
    external_id: pageId,
    notion_root_id: root.id,
    is_active: false,
    created_by: params.createdBy ?? null,
  })
  if (placeholderError && placeholderError.code !== '23505') {
    console.warn('[notion-write] placeholder source insert failed:', placeholderError.message)
  }

  try {
    await enqueueGlobalKnowledgeRootSync({
      connectionId: connection.id,
      rootId: root.id,
      jobType: 'reconcile',
      eventId: `create:${pageId}`,
    })
  } catch (error) {
    // The page exists in Notion; the hourly reconcile will still pick it up.
    console.error('[notion-write] failed to enqueue root sync:', error)
  }

  return { ok: true, pageId, url, rootId: root.id, rootTitle: root.title }
}
