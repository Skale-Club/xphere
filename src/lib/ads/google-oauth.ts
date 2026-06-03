// Google Ads OAuth — uses dedicated GOOGLE_ADS_CLIENT_ID/SECRET credentials
// (separate OAuth client from Google Contacts) with the adwords scope.
// Tokens are stored as encrypted JSON: { access_token, refresh_token }
// because Google access tokens expire in 1 hour and require refresh.

export const GOOGLE_ADS_CALLBACK_PATH = '/api/ads/google/callback'
export const GOOGLE_ADS_CALLBACK_URI = `https://xphere.app${GOOGLE_ADS_CALLBACK_PATH}`
export const GOOGLE_ADS_OAUTH_STATE_COOKIE = 'google_ads_oauth_state'
export const GOOGLE_ADS_OAUTH_STATE_MAX_AGE_SECONDS = 60 * 10

export const GOOGLE_ADS_SCOPE = 'https://www.googleapis.com/auth/adwords'

export type GoogleAdsTokens = {
  access_token: string
  refresh_token: string
  expires_in: number
}

type GoogleTokenResponse = {
  access_token: string
  refresh_token?: string
  expires_in: number
  token_type: string
}

function getGoogleEnv() {
  const clientId = process.env.GOOGLE_ADS_CLIENT_ID
  const clientSecret = process.env.GOOGLE_ADS_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    throw new Error('GOOGLE_ADS_CLIENT_ID and GOOGLE_ADS_CLIENT_SECRET must be configured.')
  }
  return { clientId, clientSecret }
}

export function buildGoogleAdsAuthUrl(state: string): string {
  const { clientId } = getGoogleEnv()
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth')
  url.searchParams.set('client_id', clientId)
  url.searchParams.set('redirect_uri', GOOGLE_ADS_CALLBACK_URI)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', GOOGLE_ADS_SCOPE)
  url.searchParams.set('state', state)
  url.searchParams.set('access_type', 'offline')
  url.searchParams.set('prompt', 'consent') // force refresh_token on every grant
  return url.toString()
}

export async function exchangeCodeForTokens(code: string): Promise<GoogleAdsTokens> {
  const { clientId, clientSecret } = getGoogleEnv()
  const body = new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: GOOGLE_ADS_CALLBACK_URI,
    grant_type: 'authorization_code',
  })
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
    cache: 'no-store',
  })
  if (!res.ok) {
    const text = await res.text().catch(() => `status ${res.status}`)
    throw new Error(`Google token exchange failed: ${text}`)
  }
  const data = (await res.json()) as GoogleTokenResponse
  if (!data.refresh_token) {
    throw new Error('Google did not return a refresh_token. Re-authorize with prompt=consent.')
  }
  return { access_token: data.access_token, refresh_token: data.refresh_token, expires_in: data.expires_in }
}

export async function refreshAccessToken(refreshToken: string): Promise<string> {
  const { clientId, clientSecret } = getGoogleEnv()
  const body = new URLSearchParams({
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'refresh_token',
  })
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
    cache: 'no-store',
  })
  if (!res.ok) {
    const text = await res.text().catch(() => `status ${res.status}`)
    throw new Error(`Google token refresh failed: ${text}`)
  }
  const data = (await res.json()) as { access_token: string }
  return data.access_token
}

export type GoogleAdsCustomer = {
  id: string
  name: string
  currency_code: string
  manager: boolean
  test_account: boolean
}

export async function listAccessibleCustomers(accessToken: string): Promise<string[]> {
  const res = await fetch(
    'https://googleads.googleapis.com/v20/customers:listAccessibleCustomers',
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'developer-token': process.env.GOOGLE_ADS_DEVELOPER_TOKEN ?? '',
      },
      cache: 'no-store',
    },
  )
  if (!res.ok) {
    const text = await res.text().catch(() => `status ${res.status}`)
    throw new Error(`Failed to list Google Ads customers: ${text}`)
  }
  const data = (await res.json()) as { resourceNames?: string[] }
  // resourceNames look like "customers/1234567890"
  return (data.resourceNames ?? []).map((r) => r.replace('customers/', ''))
}

export async function getCustomerInfo(
  customerId: string,
  accessToken: string,
): Promise<GoogleAdsCustomer> {
  const res = await fetch(
    `https://googleads.googleapis.com/v20/customers/${customerId}/googleAds:search`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'developer-token': process.env.GOOGLE_ADS_DEVELOPER_TOKEN ?? '',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query: `SELECT customer.id, customer.descriptive_name, customer.currency_code,
                       customer.manager, customer.test_account
                FROM customer LIMIT 1`,
      }),
      cache: 'no-store',
    },
  )
  if (!res.ok) {
    const text = await res.text().catch(() => `status ${res.status}`)
    throw new Error(`Failed to get customer info: ${text}`)
  }
  const data = (await res.json()) as {
    results?: Array<{
      customer: { id: string; descriptiveName?: string; currencyCode?: string; manager?: boolean; testAccount?: boolean }
    }>
  }
  const c = data.results?.[0]?.customer
  return {
    id: customerId,
    name: c?.descriptiveName ?? customerId,
    currency_code: c?.currencyCode ?? 'USD',
    manager: c?.manager ?? false,
    test_account: c?.testAccount ?? false,
  }
}
