import { getSiteOrigin } from '@/lib/site-url'

export const GOOGLE_BUSINESS_OAUTH_STATE_COOKIE = 'google_business_oauth_state'
export const GOOGLE_BUSINESS_OAUTH_STATE_MAX_AGE_SECONDS = 10 * 60
export const GOOGLE_BUSINESS_SCOPE = 'https://www.googleapis.com/auth/business.manage'

export type GoogleBusinessTokens = {
  access_token: string
  refresh_token: string
  expires_in: number
}

type GoogleAccount = { name: string; accountName?: string; type?: string; role?: string }
type GoogleLocation = {
  name: string
  title?: string
  storefrontAddress?: { addressLines?: string[]; locality?: string; administrativeArea?: string; postalCode?: string; regionCode?: string }
  metadata?: { placeId?: string; mapsUri?: string }
}

function credentials() {
  const clientId = process.env.GOOGLE_BUSINESS_CLIENT_ID ?? process.env.GOOGLE_ADS_CLIENT_ID
  const clientSecret = process.env.GOOGLE_BUSINESS_CLIENT_SECRET ?? process.env.GOOGLE_ADS_CLIENT_SECRET
  if (!clientId || !clientSecret) throw new Error('Google Business OAuth credentials are not configured')
  return { clientId, clientSecret }
}

export function googleBusinessRedirectUri(): string {
  return `${getSiteOrigin()}/api/google-business/callback`
}

export function buildGoogleBusinessAuthUrl(state: string): string {
  const { clientId } = credentials()
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth')
  url.searchParams.set('client_id', clientId)
  url.searchParams.set('redirect_uri', googleBusinessRedirectUri())
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', GOOGLE_BUSINESS_SCOPE)
  url.searchParams.set('access_type', 'offline')
  url.searchParams.set('include_granted_scopes', 'true')
  url.searchParams.set('prompt', 'consent')
  url.searchParams.set('state', state)
  return url.toString()
}

async function tokenRequest(body: URLSearchParams): Promise<Record<string, unknown>> {
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
    cache: 'no-store',
  })
  const json = await response.json().catch(() => ({})) as Record<string, unknown>
  if (!response.ok) throw new Error(String(json.error_description ?? json.error ?? `Google OAuth failed (${response.status})`))
  return json
}

export async function exchangeGoogleBusinessCode(code: string): Promise<GoogleBusinessTokens> {
  const { clientId, clientSecret } = credentials()
  const json = await tokenRequest(new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: googleBusinessRedirectUri(),
    grant_type: 'authorization_code',
  }))
  if (!json.access_token || !json.refresh_token) throw new Error('Google did not return a refresh_token. Re-authorize with prompt=consent.')
  return { access_token: String(json.access_token), refresh_token: String(json.refresh_token), expires_in: Number(json.expires_in ?? 3600) }
}

export async function refreshGoogleBusinessAccessToken(refreshToken: string): Promise<string> {
  const { clientId, clientSecret } = credentials()
  const json = await tokenRequest(new URLSearchParams({
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'refresh_token',
  }))
  if (!json.access_token) throw new Error('Google did not return an access token')
  return String(json.access_token)
}

async function googleGet<T>(url: URL, accessToken: string): Promise<T> {
  const response = await fetch(url, {
    headers: { authorization: `Bearer ${accessToken}`, 'x-goog-api-format-version': '2' },
    cache: 'no-store',
  })
  const json = await response.json().catch(() => ({})) as Record<string, unknown>
  if (!response.ok) {
    const detail = json.error as { message?: string } | undefined
    throw new Error(detail?.message ?? `Google Business API failed (${response.status})`)
  }
  return json as T
}

export async function listGoogleBusinessAccounts(accessToken: string): Promise<GoogleAccount[]> {
  const result = await googleGet<{ accounts?: GoogleAccount[] }>(new URL('https://mybusinessaccountmanagement.googleapis.com/v1/accounts'), accessToken)
  return result.accounts ?? []
}

export async function listGoogleBusinessLocations(accountName: string, accessToken: string): Promise<GoogleLocation[]> {
  const locations: GoogleLocation[] = []
  let pageToken: string | undefined
  do {
    const url = new URL(`https://mybusinessbusinessinformation.googleapis.com/v1/${accountName}/locations`)
    url.searchParams.set('readMask', 'name,title,storefrontAddress,metadata')
    url.searchParams.set('pageSize', '100')
    if (pageToken) url.searchParams.set('pageToken', pageToken)
    const result = await googleGet<{ locations?: GoogleLocation[]; nextPageToken?: string }>(url, accessToken)
    locations.push(...(result.locations ?? []))
    pageToken = result.nextPageToken
  } while (pageToken && locations.length < 1000)
  return locations
}

export function serializeGoogleBusinessTokens(tokens: GoogleBusinessTokens): string {
  return JSON.stringify(tokens)
}

export function parseGoogleBusinessTokens(raw: string): GoogleBusinessTokens {
  const parsed = JSON.parse(raw) as Partial<GoogleBusinessTokens>
  if (!parsed.access_token || !parsed.refresh_token) throw new Error('Invalid stored Google Business credential')
  return { access_token: parsed.access_token, refresh_token: parsed.refresh_token, expires_in: parsed.expires_in ?? 3600 }
}

export function formatGoogleBusinessAddress(address?: GoogleLocation['storefrontAddress']): string | null {
  if (!address) return null
  return [address.addressLines?.join(', '), address.locality, address.administrativeArea, address.postalCode, address.regionCode]
    .filter(Boolean)
    .join(', ') || null
}
