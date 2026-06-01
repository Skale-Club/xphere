// src/lib/google-contacts/oauth.ts
// Google OAuth 2.0 utilities | mirrors src/lib/meta/oauth.ts pattern

import { getSiteOrigin } from '@/lib/site-url'

export const GOOGLE_CALLBACK_PATH = '/api/google/callback'
// Build the callback against the canonical site origin (NEXT_PUBLIC_SITE_URL).
// Previously used NEXT_PUBLIC_APP_URL, which is not set in prod and bakes into
// the image as an empty string — diverging from the callback route's origin.
export const GOOGLE_CALLBACK_URI = `${getSiteOrigin()}${GOOGLE_CALLBACK_PATH}`
export const GOOGLE_OAUTH_STATE_COOKIE = 'google_oauth_state'
export const GOOGLE_OAUTH_STATE_MAX_AGE_SECONDS = 60 * 10

// `openid email` is required so the userinfo endpoint returns the account email
// (used as the display key_hint). The contacts scope alone does not grant it.
export const GOOGLE_OAUTH_SCOPE = 'openid email https://www.googleapis.com/auth/contacts'

export type GoogleTokenResponse = {
  access_token: string
  refresh_token?: string // only present on first grant with access_type=offline
  expires_in: number     // seconds, typically 3599
  token_type: string     // always "Bearer"
  scope: string
}

function getGoogleEnv() {
  const clientId = process.env.GOOGLE_CLIENT_ID
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET

  if (!clientId || !clientSecret) {
    throw new Error('GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be configured.')
  }

  return { clientId, clientSecret }
}

export function buildGoogleOAuthUrl(state: string): string {
  const { clientId } = getGoogleEnv()
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth')

  url.searchParams.set('client_id', clientId)
  url.searchParams.set('redirect_uri', GOOGLE_CALLBACK_URI)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', GOOGLE_OAUTH_SCOPE)
  url.searchParams.set('state', state)
  url.searchParams.set('access_type', 'offline') // REQUIRED | without this Google omits refresh_token

  return url.toString()
}

export async function exchangeCodeForTokens(code: string): Promise<GoogleTokenResponse> {
  const { clientId, clientSecret } = getGoogleEnv()

  // IMPORTANT: Google token endpoint requires application/x-www-form-urlencoded, NOT JSON
  const body = new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: GOOGLE_CALLBACK_URI,
    grant_type: 'authorization_code',
  })

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
    cache: 'no-store',
  })

  if (!response.ok) {
    const text = await response.text().catch(() => `status ${response.status}`)
    throw new Error(`Google token exchange failed: ${text}`)
  }

  return response.json() as Promise<GoogleTokenResponse>
}

// Non-fatal: the email is only a display hint. A userinfo hiccup (e.g. missing
// scope on an old grant) must never block the connection — return null instead.
export async function fetchGoogleUserEmail(accessToken: string): Promise<string | null> {
  try {
    const response = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: 'no-store',
    })

    if (!response.ok) {
      console.warn(`[google-callback] userinfo fetch failed: status ${response.status} | proceeding without email`)
      return null
    }

    const data = (await response.json()) as { email?: string }
    return data.email ?? null
  } catch (err) {
    console.warn('[google-callback] userinfo fetch threw | proceeding without email:', err)
    return null
  }
}
