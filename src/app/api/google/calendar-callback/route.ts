import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'
import { createClient, getUser } from '@/lib/supabase/server'
import { encrypt } from '@/lib/crypto'
import { exchangeCodeForTokens, fetchGoogleUserEmail } from '@/lib/google-contacts/oauth'

export const runtime = 'nodejs'

const CALLBACK_URI = `${process.env.NEXT_PUBLIC_SITE_URL ?? 'https://xphere.skale.club'}/api/google/calendar-callback`
const STATE_COOKIE = 'google_cal_oauth_state'

export async function GET(request: NextRequest): Promise<Response> {
  const user = await getUser()
  if (!user) return NextResponse.redirect(new URL('/login', request.url))

  const url = new URL(request.url)
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')

  const jar = await cookies()
  const storedState = jar.get(STATE_COOKIE)?.value
  jar.set(STATE_COOKIE, '', { maxAge: 0, path: '/' })

  const base = '/scheduling'

  if (!code) return NextResponse.redirect(new URL(`${base}?error=missing_code`, request.url))
  if (!state || !storedState || state !== storedState)
    return NextResponse.redirect(new URL(`${base}?error=csrf`, request.url))

  const supabase = await createClient()
  const { data: orgId } = await supabase.rpc('get_current_org_id')
  if (!orgId) return NextResponse.redirect(new URL(`${base}?error=no_org`, request.url))

  try {
    // Reuse the exchange function but with our callback URI
    const body = new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
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

    return NextResponse.redirect(new URL(`${base}?calendar_connected=true`, request.url))
  } catch {
    return NextResponse.redirect(new URL(`${base}?error=oauth_exchange`, request.url))
  }
}
