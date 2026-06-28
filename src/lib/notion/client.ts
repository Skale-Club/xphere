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

export type NotionPageSummary = {
  id: string
  title: string
  url: string | null
  parent: { type: string; page_id?: string; database_id?: string; data_source_id?: string }
  lastEditedTime: string
  inTrash: boolean
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
  properties: Record<string, {
    type?: string
    title?: Array<{ plain_text?: string }>
    rich_text?: Array<{ plain_text?: string }>
  }>
  last_edited_time: string
  in_trash?: boolean
}

export class NotionApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly retryAfterSeconds: number | null = null,
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
    throw new NotionApiError(
      `${context} failed (${response.status}): ${detail.slice(0, 500)}`,
      response.status,
      retryAfter ? Number.parseInt(retryAfter, 10) : null,
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

function extractPageTitle(page: NotionPageObject): string {
  for (const property of Object.values(page.properties)) {
    const text = property.title ?? (property.type === 'title' ? property.rich_text : undefined)
    const title = text?.map((part) => part.plain_text ?? '').join('').trim()
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
  }
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
    pages.push(...response.results.filter((item) => item.object === 'page').map(summarizePage))
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
