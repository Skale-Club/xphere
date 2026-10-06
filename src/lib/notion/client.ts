const NOTION_API_BASE_URL = 'https://api.notion.com/v1'
const NOTION_REQUEST_INTERVAL_MS = 350
let notionRequestGate = Promise.resolve()
let nextNotionRequestAt = 0

export const NOTION_API_VERSION = '2026-03-11'
export const NOTION_CALLBACK_URI = 'https://xphere.app/api/notion/callback'
export const NOTION_OAUTH_STATE_COOKIE = 'global_knowledge_notion_oauth_state'
export const NOTION_OAUTH_STATE_MAX_AGE_SECONDS = 60 * 10

type NotionOAuthConfig = {
  clientId: string
  clientSecret?: string
  redirectUri: string
}

/** A raw Notion page property value (`{ id, type, [type]: … }`). */
export type NotionPropertyValue = {
  id?: string
  type?: string
  [key: string]: unknown
}

export type NotionPageSummary = {
  id: string
  title: string
  url: string | null
  parent: { type: string; page_id?: string; database_id?: string; data_source_id?: string }
  lastEditedTime: string
  inTrash: boolean
  /** Raw property values. Child pages only carry `title`; database rows carry the schema. */
  properties: Record<string, NotionPropertyValue>
}

type NotionListResponse<T> = {
  results: T[]
  has_more: boolean
  next_cursor: string | null
}

type NotionPageObject = {
  object: 'page'
  id: string
  url?: string
  parent: NotionPageSummary['parent']
  properties: Record<string, NotionPropertyValue>
  last_edited_time: string
  in_trash?: boolean
}

export class NotionApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly retryAfterSeconds: number | null = null,
    /** Notion's error `code` (e.g. `restricted_resource`, `validation_error`) when the body had one. */
    public readonly code: string | null = null,
  ) {
    super(message)
    this.name = 'NotionApiError'
  }
}

export type NotionOAuthTokens = {
  access_token: string
  refresh_token: string | null
  expires_in: number | null
  bot_id: string
  workspace_id: string
  workspace_name: string | null
  workspace_icon: string | null
  owner: {
    type: string
    user?: { id: string }
  }
}

function getNotionOAuthConfig(): Required<NotionOAuthConfig> {
  const clientId = process.env.NOTION_CLIENT_ID
  const clientSecret = process.env.NOTION_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    throw new Error('NOTION_CLIENT_ID and NOTION_CLIENT_SECRET must be configured.')
  }
  return { clientId, clientSecret, redirectUri: NOTION_CALLBACK_URI }
}

export function buildNotionAuthorizationUrl(
  state: string,
  config: Pick<NotionOAuthConfig, 'clientId' | 'redirectUri'> = getNotionOAuthConfig(),
): string {
  const url = new URL(`${NOTION_API_BASE_URL}/oauth/authorize`)
  url.searchParams.set('client_id', config.clientId)
  url.searchParams.set('redirect_uri', config.redirectUri)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('owner', 'user')
  url.searchParams.set('state', state)
  return url.toString()
}

function basicAuthorization(config: Required<NotionOAuthConfig>): string {
  return `Basic ${btoa(`${config.clientId}:${config.clientSecret}`)}`
}

async function readJson<T>(response: Response, context: string): Promise<T> {
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    const retryAfter = response.headers.get('retry-after')
    let code: string | null = null
    try {
      const parsed = JSON.parse(detail) as { code?: unknown }
      if (typeof parsed.code === 'string') code = parsed.code
    } catch {
      // Non-JSON error body; the status is still informative.
    }
    throw new NotionApiError(
      `${context} failed (${response.status}): ${detail.slice(0, 500)}`,
      response.status,
      retryAfter ? Number.parseInt(retryAfter, 10) : null,
      code,
    )
  }
  return response.json() as Promise<T>
}

async function waitForNotionRateSlot(): Promise<void> {
  const previous = notionRequestGate
  let release!: () => void
  notionRequestGate = new Promise<void>((resolve) => {
    release = resolve
  })
  await previous
  const delay = Math.max(0, nextNotionRequestAt - Date.now())
  if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay))
  nextNotionRequestAt = Date.now() + NOTION_REQUEST_INTERVAL_MS
  release()
}

export async function exchangeNotionCode(
  code: string,
  config: Required<NotionOAuthConfig> = getNotionOAuthConfig(),
): Promise<NotionOAuthTokens> {
  const response = await fetch(`${NOTION_API_BASE_URL}/oauth/token`, {
    method: 'POST',
    headers: {
      Authorization: basicAuthorization(config),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      code,
      redirect_uri: config.redirectUri,
    }),
    cache: 'no-store',
  })
  return readJson<NotionOAuthTokens>(response, 'Notion OAuth exchange')
}

export async function refreshNotionTokens(
  refreshToken: string,
  config: Required<NotionOAuthConfig> = getNotionOAuthConfig(),
): Promise<NotionOAuthTokens> {
  const response = await fetch(`${NOTION_API_BASE_URL}/oauth/token`, {
    method: 'POST',
    headers: {
      Authorization: basicAuthorization(config),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
    cache: 'no-store',
  })
  return readJson<NotionOAuthTokens>(response, 'Notion token refresh')
}

export async function notionRequest<T>(
  accessToken: string,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  await waitForNotionRateSlot()
  const response = await fetch(`${NOTION_API_BASE_URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Notion-Version': NOTION_API_VERSION,
      'Content-Type': 'application/json',
      ...init.headers,
    },
    cache: 'no-store',
  })
  return readJson<T>(response, `Notion ${init.method ?? 'GET'} ${path}`)
}

type RichTextPart = { plain_text?: string; text?: { content?: string } }

function richTextToPlain(value: unknown): string {
  if (!Array.isArray(value)) return ''
  return (value as RichTextPart[])
    .map((part) => part?.plain_text ?? part?.text?.content ?? '')
    .join('')
}

function extractPageTitle(page: NotionPageObject): string {
  for (const property of Object.values(page.properties ?? {})) {
    const text = property.title ?? (property.type === 'title' ? property.rich_text : undefined)
    const title = richTextToPlain(text).trim()
    if (title) return title
  }
  return 'Untitled'
}

function summarizePage(page: NotionPageObject): NotionPageSummary {
  return {
    id: page.id,
    title: extractPageTitle(page),
    url: page.url ?? null,
    parent: page.parent,
    lastEditedTime: page.last_edited_time,
    inTrash: page.in_trash ?? false,
    properties: page.properties ?? {},
  }
}

/** True when the page is a row of a database / data source (its content often lives in properties). */
export function isNotionDatabaseRow(parent: NotionPageSummary['parent'] | null | undefined): boolean {
  return parent?.type === 'data_source_id' || parent?.type === 'database_id'
}

// Property types whose value is metadata noise for retrieval (or opaque ids)
// rather than knowledge. Timestamps would also churn the content hash.
const SKIPPED_PROPERTY_TYPES = new Set([
  'title',
  'created_time',
  'last_edited_time',
  'created_by',
  'last_edited_by',
  'relation',
  'button',
])

function formatDateValue(value: unknown): string {
  if (!value || typeof value !== 'object') return ''
  const date = value as { start?: string | null; end?: string | null }
  if (!date.start) return ''
  return date.end ? `${date.start} → ${date.end}` : date.start
}

function namedList(value: unknown): string {
  if (!Array.isArray(value)) return ''
  return value
    .map((item) => (item && typeof item === 'object' ? (item as { name?: unknown }).name : null))
    .filter((name): name is string => typeof name === 'string' && name.trim().length > 0)
    .join(', ')
}

/** Plain-text rendering of one property value; '' when empty or not meaningful. */
export function notionPropertyValueToText(property: NotionPropertyValue): string {
  const type = property.type ?? ''
  const value = property[type]
  switch (type) {
    case 'rich_text':
      return richTextToPlain(value).trim()
    case 'number':
      return typeof value === 'number' && Number.isFinite(value) ? String(value) : ''
    case 'select':
    case 'status':
      return value && typeof value === 'object' ? String((value as { name?: unknown }).name ?? '').trim() : ''
    case 'multi_select':
    case 'people':
    case 'files':
      return namedList(value)
    case 'date':
      return formatDateValue(value)
    case 'checkbox':
      return value === true ? 'Yes' : value === false ? 'No' : ''
    case 'url':
    case 'email':
    case 'phone_number':
      return typeof value === 'string' ? value.trim() : ''
    case 'unique_id': {
      const id = value as { prefix?: string | null; number?: number | null } | null
      if (!id || id.number == null) return ''
      return id.prefix ? `${id.prefix}-${id.number}` : String(id.number)
    }
    case 'formula': {
      const formula = value as { type?: string; [key: string]: unknown } | null
      if (!formula?.type) return ''
      const inner = formula[formula.type]
      if (formula.type === 'date') return formatDateValue(inner)
      if (formula.type === 'boolean') return inner === true ? 'Yes' : inner === false ? 'No' : ''
      if (inner == null) return ''
      return String(inner).trim()
    }
    case 'rollup': {
      const rollup = value as { type?: string; [key: string]: unknown } | null
      if (!rollup?.type) return ''
      const inner = rollup[rollup.type]
      if (rollup.type === 'number') return typeof inner === 'number' ? String(inner) : ''
      if (rollup.type === 'date') return formatDateValue(inner)
      if (rollup.type === 'array' && Array.isArray(inner)) {
        return (inner as NotionPropertyValue[])
          .map((item) => notionPropertyValueToText(item))
          .filter(Boolean)
          .join(', ')
      }
      return ''
    }
    default:
      return ''
  }
}

/**
 * Render a database row's properties as a Markdown "Properties" section
 * (`- Name: value`, skipping empty values and the title). Returns '' when no
 * property carries text. Order follows the object's key order, which Notion
 * keeps stable for a given schema, so the content hash is stable too.
 */
export function formatNotionPropertiesAsMarkdown(
  properties: Record<string, NotionPropertyValue> | null | undefined,
): string {
  const lines: string[] = []
  for (const [name, property] of Object.entries(properties ?? {})) {
    if (!property || SKIPPED_PROPERTY_TYPES.has(property.type ?? '')) continue
    const text = notionPropertyValueToText(property).replace(/\s+/g, ' ').trim()
    if (!text) continue
    lines.push(`- ${name.trim()}: ${text}`)
  }
  return lines.length > 0 ? `## Properties\n\n${lines.join('\n')}` : ''
}

export async function searchAccessibleNotionPages(
  accessToken: string,
): Promise<NotionPageSummary[]> {
  const pages: NotionPageSummary[] = []
  let cursor: string | null = null

  do {
    const response: NotionListResponse<NotionPageObject> = await notionRequest(
      accessToken,
      '/search',
      {
        method: 'POST',
        body: JSON.stringify({
          filter: { property: 'object', value: 'page' },
          sort: { direction: 'descending', timestamp: 'last_edited_time' },
          page_size: 100,
          ...(cursor ? { start_cursor: cursor } : {}),
        }),
      },
    )
    // The picker only needs id/title; don't ship every page's properties to the browser.
    pages.push(...response.results
      .filter((item) => item.object === 'page')
      .map((item) => ({ ...summarizePage(item), properties: {} })))
    cursor = response.has_more ? response.next_cursor : null
  } while (cursor)

  return pages
}

export async function retrieveNotionPage(
  accessToken: string,
  pageId: string,
): Promise<NotionPageSummary> {
  const page = await notionRequest<NotionPageObject>(
    accessToken,
    `/pages/${encodeURIComponent(pageId)}`,
  )
  return summarizePage(page)
}

export async function retrieveNotionPageMarkdown(
  accessToken: string,
  pageId: string,
): Promise<{ markdown: string; truncated: boolean; unknown_block_ids: string[] }> {
  return notionRequest(
    accessToken,
    `/pages/${encodeURIComponent(pageId)}/markdown`,
  )
}

export type NotionBlock = {
  object: 'block'
  id: string
  type: string
  has_children: boolean
  child_page?: { title?: string }
  child_database?: { title?: string }
  [key: string]: unknown
}

export async function retrieveNotionBlockChildren(
  accessToken: string,
  blockId: string,
): Promise<NotionBlock[]> {
  const blocks: NotionBlock[] = []
  let cursor: string | null = null
  do {
    const query = new URLSearchParams({ page_size: '100' })
    if (cursor) query.set('start_cursor', cursor)
    const response: NotionListResponse<NotionBlock> = await notionRequest(
      accessToken,
      `/blocks/${encodeURIComponent(blockId)}/children?${query}`,
    )
    blocks.push(...response.results)
    cursor = response.has_more ? response.next_cursor : null
  } while (cursor)
  return blocks
}

export type NotionDatabaseSummary = {
  id: string
  title: string
  inTrash: boolean
  dataSources: Array<{ id: string; name: string }>
}

/**
 * GET /v1/databases/{id}. Since API 2025-09-03 a database is a container of
 * one or more data sources; rows are queried per data source.
 */
export async function retrieveNotionDatabase(
  accessToken: string,
  databaseId: string,
): Promise<NotionDatabaseSummary> {
  const database = await notionRequest<{
    id: string
    title?: unknown
    in_trash?: boolean
    data_sources?: Array<{ id?: string; name?: string }>
  }>(accessToken, `/databases/${encodeURIComponent(databaseId)}`)
  return {
    id: database.id,
    title: richTextToPlain(database.title).trim() || 'Untitled',
    inTrash: database.in_trash ?? false,
    dataSources: (database.data_sources ?? [])
      .filter((source): source is { id: string; name?: string } => typeof source.id === 'string')
      .map((source) => ({ id: source.id, name: source.name ?? '' })),
  }
}

/**
 * POST /v1/data_sources/{id}/query, paginated. Returns the row pages (wiki
 * data sources can also return nested data sources; those are skipped).
 * `limit` stops paging early so a huge database cannot exhaust the sync.
 */
export async function queryNotionDataSourcePages(
  accessToken: string,
  dataSourceId: string,
  options: { limit?: number } = {},
): Promise<NotionPageSummary[]> {
  const limit = options.limit ?? Number.POSITIVE_INFINITY
  const pages: NotionPageSummary[] = []
  let cursor: string | null = null
  do {
    const response: NotionListResponse<NotionPageObject | { object: string; id: string }> =
      await notionRequest(
        accessToken,
        `/data_sources/${encodeURIComponent(dataSourceId)}/query`,
        {
          method: 'POST',
          body: JSON.stringify({
            page_size: 100,
            ...(cursor ? { start_cursor: cursor } : {}),
          }),
        },
      )
    for (const item of response.results) {
      if (item.object !== 'page') continue
      pages.push(summarizePage(item as NotionPageObject))
      if (pages.length >= limit) return pages
    }
    cursor = response.has_more ? response.next_cursor : null
  } while (cursor)
  return pages
}

/**
 * POST /v1/pages with a Notion-flavored Markdown body (supported natively
 * since the markdown content API; mutually exclusive with `children`).
 * Requires the integration's "Insert content" capability on the parent.
 */
export async function createNotionPageFromMarkdown(
  accessToken: string,
  params: { parentPageId: string; title: string; markdown: string },
): Promise<NotionPageSummary> {
  const page = await notionRequest<NotionPageObject>(accessToken, '/pages', {
    method: 'POST',
    body: JSON.stringify({
      parent: { type: 'page_id', page_id: params.parentPageId },
      properties: {
        title: { title: [{ type: 'text', text: { content: params.title } }] },
      },
      markdown: params.markdown,
    }),
  })
  return summarizePage(page)
}

/**
 * Append Markdown at the end of a page via PATCH /v1/pages/{id}/markdown.
 * `insert_content` is marked legacy in the docs but remains the only command
 * that appends without re-sending the whole page.
 */
export async function appendNotionPageMarkdown(
  accessToken: string,
  pageId: string,
  markdown: string,
): Promise<void> {
  await notionRequest(accessToken, `/pages/${encodeURIComponent(pageId)}/markdown`, {
    method: 'PATCH',
    body: JSON.stringify({
      type: 'insert_content',
      insert_content: { content: markdown, position: { type: 'end' } },
    }),
  })
}
