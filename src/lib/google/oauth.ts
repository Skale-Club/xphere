import 'server-only'

// Shared Google OAuth 2.0 helper (authorization-code flow with offline
// access). Google Contacts, Calendar and Ads each grew their own copy; new
// integrations (Business Profile first) use this one, and the older ones can
// move over when they are next touched.
//
// Uses the platform's GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET. Every redirect
// URI built here must be registered on that OAuth client in Google Cloud.

import { getSiteOrigin } from '@/lib/site-url'

export type GoogleTokens = {
  access_token: string
  refresh_token?: string
  expires_in: number
  scope?: string
  token_type?: string
}

/** invalid_grant = the refresh token is dead (revoked, expired, app in Testing for 7 days). */
export class GoogleAuthError extends Error {
  constructor(
    readonly code: 'invalid_grant' | 'not_configured' | 'exchange_failed' | 'refresh_failed',
    message: string,
  ) {
    super(message)
    this.name = 'GoogleAuthError'
  }
}

function env() {
  const clientId = process.env.GOOGLE_CLIENT_ID
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    throw new GoogleAuthError('not_configured', 'GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be configured.')
  }
  return { clientId, clientSecret }
}

export function googleRedirectUri(path: string): string {
  return `${getSiteOrigin()}${path}`
}

export function buildGoogleAuthUrl(input: { scopes: string[]; redirectPath: string; state: string; loginHint?: string }): string {
  const { clientId } = env()
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth')
  url.searchParams.set('client_id', clientId)
  url.searchParams.set('redirect_uri', googleRedirectUri(input.redirectPath))
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', input.scopes.join(' '))
  url.searchParams.set('state', input.state)
  url.searchParams.set('access_type', 'offline')
  // Without consent Google omits refresh_token on a reconnect.
  url.searchParams.set('prompt', 'consent')
  url.searchParams.set('include_granted_scopes', 'true')
  if (input.loginHint) url.searchParams.set('login_hint', input.loginHint)
  return url.toString()
}

async function tokenRequest(body: Record<string, string>): Promise<Response> {
  return fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString(),
    cache: 'no-store',
    signal: AbortSignal.timeout(20_000),
  })
}

export async function exchangeGoogleCode(code: string, redirectPath: string): Promise<GoogleTokens> {
  const { clientId, clientSecret } = env()
  const res = await tokenRequest({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: googleRedirectUri(redirectPath),
    grant_type: 'authorization_code',
  })
  if (!res.ok) {
    throw new GoogleAuthError('exchange_failed', `Google token exchange failed: ${await res.text().catch(() => res.status)}`)
  }
  return (await res.json()) as GoogleTokens
}

export async function refreshGoogleAccessToken(refreshToken: string): Promise<GoogleTokens> {
  const { clientId, clientSecret } = env()
  const res = await tokenRequest({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  })
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string; error_description?: string } | null
    if (body?.error === 'invalid_grant') {
      throw new GoogleAuthError('invalid_grant', 'Google revoked access for this account. Reconnect it.')
    }
    throw new GoogleAuthError('refresh_failed', `Google token refresh failed: ${body?.error_description ?? res.status}`)
  }
  return (await res.json()) as GoogleTokens
}

/** Account email for display. Never throws. */
export async function fetchGoogleEmail(accessToken: string): Promise<string | null> {
  try {
    const res = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: 'no-store',
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) return null
    return ((await res.json()) as { email?: string }).email ?? null
  } catch {
    return null
  }
}
