import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'

import { encrypt } from '@/lib/crypto'
import {
  GOOGLE_OAUTH_STATE_COOKIE,
  exchangeCodeForTokens,
  fetchGoogleUserEmail,
} from '@/lib/google-contacts/oauth'
import { createClient, getUser } from '@/lib/supabase/server'

export const runtime = 'nodejs'

const STATE_COOKIE_CLEAR_OPTIONS = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production',
  path: '/',
  maxAge: 0,
}

function buildRedirect(request: NextRequest, path: string) {
  return NextResponse.redirect(new URL(path, request.url))
}

async function clearStateCookie() {
  const jar = await cookies()
  jar.set(GOOGLE_OAUTH_STATE_COOKIE, '', STATE_COOKIE_CLEAR_OPTIONS)
}

export async function GET(request: NextRequest): Promise<Response> {
  const user = await getUser()

  if (!user) {
    return buildRedirect(request, '/')
  }

  const url = new URL(request.url)
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')

  const jar = await cookies()
  const storedState = jar.get(GOOGLE_OAUTH_STATE_COOKIE)?.value

  await clearStateCookie()

  if (!code) {
    return buildRedirect(request, '/integrations/google-contacts?error=missing_code')
  }

  if (!state || !storedState || state !== storedState) {
    return buildRedirect(request, '/integrations/google-contacts?error=csrf')
  }

  // D-09: always resolve org from session | never trust request params
  const supabase = await createClient()
  const { data: orgId } = await supabase.rpc('get_current_org_id')

  if (!orgId) {
    return buildRedirect(request, '/integrations/google-contacts?error=no_org')
  }

  try {
    const tokens = await exchangeCodeForTokens(code)

    // Pitfall 2: refresh_token may be absent on reconnect (Google only issues on first grant).
    // Log a warning but do not fail | the row will be upserted with whatever tokens are present.
    if (!tokens.refresh_token) {
      console.warn('[google-callback] refresh_token absent | this may be a reconnect. Proceeding with available tokens.')
    }

    const googleEmail = await fetchGoogleUserEmail(tokens.access_token)

    // D-02: encrypt only the token blob | encrypt() takes a STRING, not an object
    const encryptedBlob = await encrypt(JSON.stringify({ access_token: tokens.access_token, refresh_token: tokens.refresh_token ?? null }))

    const tokenExpiry = new Date(Date.now() + tokens.expires_in * 1000).toISOString()

    const { error: upsertError } = await supabase
      .from('integrations')
      .upsert(
        {
          organization_id: orgId,
          provider: 'google_contacts', // D-05
          name: 'Google Contacts',
          encrypted_api_key: encryptedBlob,  // D-02: { access_token, refresh_token } encrypted
          key_hint: googleEmail,             // D-04: unencrypted email for display
          config: {                          // D-03: non-sensitive metadata in JSONB
            token_expiry: tokenExpiry,
            google_email: googleEmail,
          },
          is_active: true,
        },
        { onConflict: 'organization_id,provider' } // D-06: enforced unique constraint
      )

    if (upsertError) {
      throw new Error(upsertError.message)
    }

    // D-07: redirect to integrations page with success indicator
    return buildRedirect(request, '/integrations/google-contacts?connected=true')
  } catch {
    return buildRedirect(request, '/integrations/google-contacts?error=oauth_exchange')
  }
}
