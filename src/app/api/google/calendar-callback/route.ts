import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'
import { createClient, getUser } from '@/lib/supabase/server'
import { encrypt } from '@/lib/crypto'
import { fetchGoogleUserEmail } from '@/lib/google-contacts/oauth'
import { resolveRequestOrigin } from '@/lib/site-url'

export const runtime = 'nodejs'

const STATE_COOKIE = 'google_cal_oauth_state'
const RETURN_COOKIE = 'google_cal_oauth_return'

export async function GET(request: NextRequest): Promise<Response> {
  const origin = resolveRequestOrigin(request)
  const CALLBACK_URI = `${origin}/api/google/calendar-callback`
  const user = await getUser()
  if (!user) return NextResponse.redirect(`${origin}/`)

  const url = new URL(request.url)
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')

  const jar = await cookies()
  const storedState = jar.get(STATE_COOKIE)?.value
  jar.set(STATE_COOKIE, '', { maxAge: 0, path: '/' })

  // Honor the return path captured at the start of the handshake; clear it.
  const storedReturn = jar.get(RETURN_COOKIE)?.value
  jar.set(RETURN_COOKIE, '', { maxAge: 0, path: '/' })
  const base =
    storedReturn && storedReturn.startsWith('/') && !storedReturn.startsWith('//')
      ? storedReturn
      : '/calendar'

  if (!code) return NextResponse.redirect(`${origin}${base}?error=missing_code`)
  if (!state || !storedState || state !== storedState)
    return NextResponse.redirect(`${origin}${base}?error=csrf`)

  const supabase = await createClient()
  const { data: orgId } = await supabase.rpc('get_current_org_id')
  if (!orgId) return NextResponse.redirect(`${origin}${base}?error=no_org`)

  try {
    // Reuse the exchange function but with our callback URI
    const body = new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CALENDAR_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CALENDAR_CLIENT_SECRET!,
      redirect_uri: CALLBACK_URI,
      grant_type: 'authorization_code',
    })
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      cache: 'no-store',
    })
    if (!tokenRes.ok) throw new Error('token_exchange_failed')
    const tokens = (await tokenRes.json()) as {
      access_token: string
      refresh_token?: string
      expires_in: number
    }

    const googleEmail = await fetchGoogleUserEmail(tokens.access_token)
    const blob = { access_token: tokens.access_token, refresh_token: tokens.refresh_token ?? null }
    const encryptedBlob = await encrypt(JSON.stringify(blob))
    const tokenExpiry = Date.now() + tokens.expires_in * 1000

    await supabase.from('integrations').upsert(
      {
        organization_id: orgId,
        provider: 'google_calendar',
        name: 'Google Calendar',
        encrypted_api_key: encryptedBlob,
        key_hint: googleEmail,
        config: { token_expiry: tokenExpiry, google_email: googleEmail },
        is_active: true,
      },
      { onConflict: 'organization_id,provider' },
    )

    // Reopen the integration panel when returning to /integrations; the
    // /calendar page ignores `open` and reads `calendar_connected`.
    const successQuery = base.startsWith('/integrations')
      ? 'open=google_calendar'
      : 'calendar_connected=true'
    return NextResponse.redirect(`${origin}${base}?${successQuery}`)
  } catch {
    return NextResponse.redirect(`${origin}${base}?error=oauth_exchange`)
  }
}
