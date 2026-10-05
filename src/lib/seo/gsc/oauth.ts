// Google Search Console OAuth (spec decision D2).
//
// Reuses the platform's existing Google OAuth client — GOOGLE_CLIENT_ID /
// GOOGLE_CLIENT_SECRET, the one Google Contacts uses — as a SEPARATE grant:
// its own connect/callback routes, its own integrations row
// (provider 'google_search_console') and only the scopes it needs. Connecting
// or revoking Search Console never touches the Contacts token, and vice versa.

export const GSC_SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly'
// openid + email so userinfo returns the account email shown as the key hint.
export const GSC_OAUTH_SCOPES = `openid email ${GSC_SCOPE}`
export const GSC_CALLBACK_PATH = '/api/google/search-console/callback'
export const GSC_STATE_COOKIE = 'google_gsc_oauth_state'
export const GSC_RETURN_COOKIE = 'google_gsc_oauth_return'
export const GSC_STATE_MAX_AGE_SECONDS = 600

export interface GoogleTokenResponse {
  access_token: string
  refresh_token?: string
  expires_in: number
  scope: string
  token_type: string
}

/** Stored (encrypted) in integrations.encrypted_api_key. */
export interface GscTokenBlob {
  access_token: string
  refresh_token: string | null
}

export class GoogleOAuthError extends Error {
  constructor(
    message: string,
    /** Google's `error` code, e.g. invalid_grant when the grant was revoked/expired. */
    public readonly code: string | null,
  ) {
    super(message)
    this.name = 'GoogleOAuthError'
  }
}

function env() {
  const clientId = process.env.GOOGLE_CLIENT_ID
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET
  if (!clientId || !clientSecret) throw new Error('GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be configured.')
  return { clientId, clientSecret }
}

export function buildGscAuthUrl(redirectUri: string, state: string): string {
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth')
  url.searchParams.set('client_id', env().clientId)
  url.searchParams.set('redirect_uri', redirectUri)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', GSC_OAUTH_SCOPES)
  url.searchParams.set('state', state)
  url.searchParams.set('access_type', 'offline')
  // Always re-consent so Google re-issues a refresh token on reconnect.
  url.searchParams.set('prompt', 'consent')
  return url.toString()
}

async function tokenRequest(params: Record<string, string>): Promise<GoogleTokenResponse> {
  const { clientId, clientSecret } = env()
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, ...params }).toString(),
    cache: 'no-store',
  })
  const json = (await res.json().catch(() => ({}))) as Partial<GoogleTokenResponse> & { error?: string; error_description?: string }
  if (!res.ok || !json.access_token) {
    throw new GoogleOAuthError(
      `Google token request failed: ${json.error_description ?? json.error ?? `HTTP ${res.status}`}`,
      json.error ?? null,
    )
  }
  return json as GoogleTokenResponse
}

export function exchangeGscCode(code: string, redirectUri: string) {
  return tokenRequest({ code, redirect_uri: redirectUri, grant_type: 'authorization_code' })
}

export function refreshGscToken(refreshToken: string) {
  return tokenRequest({ refresh_token: refreshToken, grant_type: 'refresh_token' })
}

/** Granular consent lets users untick scopes; verify Search Console was granted. */
export function grantedSearchConsole(scope: string | undefined): boolean {
  return (scope ?? '').split(/\s+/).includes(GSC_SCOPE)
}
