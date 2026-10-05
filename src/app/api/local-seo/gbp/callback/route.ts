// Google Business Profile OAuth callback: checks the CSRF state, exchanges
// the code, stores the encrypted tokens on gbp_connections (one row per org
// and Google account) and returns to the page that started the flow.

import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'

import { decrypt, encrypt } from '@/lib/crypto'
import { GBP_SCOPES } from '@/lib/gbp/client'
import { exchangeGoogleCode, fetchGoogleEmail } from '@/lib/google/oauth'
import { can } from '@/lib/rbac/server'
import { resolveRequestOrigin } from '@/lib/site-url'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import { createClient, getUser } from '@/lib/supabase/server'

export const runtime = 'nodejs'

const STATE_COOKIE = 'gbp_oauth_state'
const CALLBACK_PATH = '/api/local-seo/gbp/callback'

export async function GET(request: NextRequest): Promise<Response> {
  let origin = 'https://xphere.app'
  try {
    origin = resolveRequestOrigin(request)
  } catch {
    /* keep canonical */
  }
  const jar = await cookies()
  const raw = jar.get(STATE_COOKIE)?.value
  jar.set(STATE_COOKIE, '', { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: 0 })

  let stored: { state?: string; returnTo?: string } = {}
  try {
    stored = raw ? (JSON.parse(raw) as typeof stored) : {}
  } catch {
    stored = {}
  }
  const returnTo = stored.returnTo?.startsWith('/local-seo') ? stored.returnTo : '/local-seo'
  const back = (status: string) => NextResponse.redirect(new URL(`${returnTo}${returnTo.includes('?') ? '&' : '?'}gbp=${status}`, origin))

  try {
    const user = await getUser()
    if (!user) return NextResponse.redirect(new URL('/', origin))
    const params = request.nextUrl.searchParams
    if (params.get('error')) return back('denied')
    const code = params.get('code')
    if (!code) return back('missing_code')
    if (!stored.state || params.get('state') !== stored.state) return back('csrf')
    if (!(await can('local_seo.admin'))) return back('forbidden')

    const supabase = await createClient()
    const { data: orgId } = await supabase.rpc('get_current_org_id')
    if (!orgId) return back('no_org')

    const tokens = await exchangeGoogleCode(code, CALLBACK_PATH)
    const granted = (tokens.scope ?? '').split(' ')
    if (!granted.includes('https://www.googleapis.com/auth/business.manage')) return back('scope_missing')
    const email = await fetchGoogleEmail(tokens.access_token)

    const admin = createServiceRoleClient()
    const { data: existing } = await admin
      .from('gbp_connections')
      .select('id, encrypted_tokens')
      .eq('org_id', orgId as string)
      .eq('google_email', email ?? '')
      .maybeSingle()

    // Google can omit refresh_token on a reconnect; keep the one we have.
    let refreshToken = tokens.refresh_token ?? null
    if (!refreshToken && existing) {
      try {
        refreshToken = (JSON.parse(await decrypt(existing.encrypted_tokens)) as { refresh_token?: string | null }).refresh_token ?? null
      } catch {
        refreshToken = null
      }
    }
    if (!refreshToken) return back('no_refresh_token')
    const blob = await encrypt(JSON.stringify({ access_token: tokens.access_token, refresh_token: refreshToken }))
    const row = {
      org_id: orgId as string,
      google_email: email,
      encrypted_tokens: blob,
      scopes: granted.length ? granted : GBP_SCOPES,
      status: 'active' as const,
      connection_error: null,
      token_expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
      last_verified_at: new Date().toISOString(),
      connected_by: user.id,
    }
    const { error } = existing
      ? await admin.from('gbp_connections').update(row).eq('id', existing.id)
      : await admin.from('gbp_connections').insert(row)
    if (error) return back('save_failed')
    return back('connected')
  } catch (err) {
    console.error('[gbp-callback] failed', err instanceof Error ? err.message : err)
    return back('error')
  }
}
