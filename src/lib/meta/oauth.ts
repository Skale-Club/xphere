export const META_GRAPH_VERSION = 'v21.0'
export const META_CALLBACK_PATH = '/api/meta/callback'
export const META_CALLBACK_URI = `${process.env.NEXT_PUBLIC_APP_URL ?? 'https://xphere.app'}${META_CALLBACK_PATH}`
export const META_OAUTH_STATE_COOKIE = 'meta_oauth_state'
export const META_OAUTH_STATE_MAX_AGE_SECONDS = 60 * 10

export const META_OAUTH_SCOPES = [
  'pages_show_list',
  'pages_messaging',
  'instagram_manage_messages',
  'pages_read_engagement',
] as const

type MetaErrorPayload = {
  error?: {
    message?: string
    type?: string
    code?: number
  }
}

type MetaTokenResponse = {
  access_token: string
  token_type?: string
  expires_in?: number
}

type MetaAccountsResponse = {
  data?: Array<{
    id: string
    name: string
    access_token: string
  }>
}

type MetaInstagramResponse = {
  instagram_business_account?: {
    id: string
    username?: string | null
  } | null
}

export type MetaPageAccount = {
  id: string
  name: string
  accessToken: string
}

export type MetaInstagramAccount = {
  id: string
  username: string | null
}

function getMetaEnv() {
  const appId = process.env.META_APP_ID
  const appSecret = process.env.META_APP_SECRET

  if (!appId || !appSecret) {
    throw new Error('META_APP_ID and META_APP_SECRET must be configured.')
  }

  return { appId, appSecret }
}

async function readMetaError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as MetaErrorPayload
    return body.error?.message || `Meta request failed with status ${response.status}`
  } catch {
    return `Meta request failed with status ${response.status}`
  }
}

async function fetchMetaJson<T>(url: URL): Promise<T> {
  const response = await fetch(url, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    cache: 'no-store',
  })

  if (!response.ok) {
    throw new Error(await readMetaError(response))
  }

  return response.json() as Promise<T>
}

export function buildMetaOAuthUrl(state: string): string {
  const { appId } = getMetaEnv()
  const url = new URL('https://www.facebook.com/dialog/oauth')

  url.searchParams.set('client_id', appId)
  url.searchParams.set('redirect_uri', META_CALLBACK_URI)
  url.searchParams.set('scope', META_OAUTH_SCOPES.join(','))
  url.searchParams.set('state', state)
  url.searchParams.set('response_type', 'code')

  return url.toString()
}

export async function exchangeCodeForShortLivedToken(code: string): Promise<MetaTokenResponse> {
  const { appId, appSecret } = getMetaEnv()
  const url = new URL(`https://graph.facebook.com/${META_GRAPH_VERSION}/oauth/access_token`)

  url.searchParams.set('client_id', appId)
  url.searchParams.set('client_secret', appSecret)
  url.searchParams.set('redirect_uri', META_CALLBACK_URI)
  url.searchParams.set('code', code)

  return fetchMetaJson<MetaTokenResponse>(url)
}

export async function exchangeShortLivedTokenForLongLivedToken(
  shortLivedToken: string
): Promise<MetaTokenResponse> {
  const { appId, appSecret } = getMetaEnv()
  const url = new URL('https://graph.facebook.com/oauth/access_token')

  url.searchParams.set('grant_type', 'fb_exchange_token')
  url.searchParams.set('client_id', appId)
  url.searchParams.set('client_secret', appSecret)
  url.searchParams.set('fb_exchange_token', shortLivedToken)

  return fetchMetaJson<MetaTokenResponse>(url)
}

export async function fetchMetaPages(userAccessToken: string): Promise<MetaPageAccount[]> {
  const url = new URL(`https://graph.facebook.com/${META_GRAPH_VERSION}/me/accounts`)
  url.searchParams.set('access_token', userAccessToken)

  const response = await fetchMetaJson<MetaAccountsResponse>(url)

  return (response.data ?? []).map((page) => ({
    id: page.id,
    name: page.name,
    accessToken: page.access_token,
  }))
}

export async function fetchInstagramBusinessAccount(
  pageId: string,
  pageAccessToken: string
): Promise<MetaInstagramAccount | null> {
  const url = new URL(`https://graph.facebook.com/${META_GRAPH_VERSION}/${pageId}`)
  url.searchParams.set('fields', 'instagram_business_account{id,username}')
  url.searchParams.set('access_token', pageAccessToken)

  const response = await fetchMetaJson<MetaInstagramResponse>(url)
  const account = response.instagram_business_account

  if (!account?.id) {
    return null
  }

  return {
    id: account.id,
    username: account.username ?? null,
  }
}
