// Google Search Console OAuth callback (SEO module, phase 2).
//
// Verifies the CSRF state, pins the org captured at /connect, exchanges the
// code and stores the encrypted token blob in integrations
// (provider 'google_search_console'). Never surfaces a raw 500: every path
// redirects back to where the user started, with ?gsc_error= or ?gsc=connected.

import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'
import { encrypt } from '@/lib/crypto'
import { fetchGoogleUserEmail } from '@/lib/google-contacts/oauth'
import { createClientForOrg, getUser } from '@/lib/supabase/server'
import { resolveRequestOrigin } from '@/lib/site-url'
import { isOrgId, orgPath } from '@/lib/org/request-org'
import {
  GSC_CALLBACK_PATH,
  GSC_RETURN_COOKIE,
  GSC_STATE_COOKIE,
  exchangeGscCode,
  grantedSearchConsole,
  type GscTokenBlob,
} from '@/lib/seo/gsc/oauth'

export const runtime = 'nodejs'

const CANONICAL_FALLBACK = 'https://xphere.app'

export async function GET(request: NextRequest): Promise<Response> {
  let origin = CANONICAL_FALLBACK
  try {
    origin = resolveRequestOrigin(request)
    new URL('/', origin)
  } catch {
    origin = CANONICAL_FALLBACK
  }

  const jar = await cookies()
  const stored = jar.get(GSC_STATE_COOKIE)?.value ?? ''
  const storedReturn = jar.get(GSC_RETURN_COOKIE)?.value
  jar.set(GSC_STATE_COOKIE, '', { maxAge: 0, path: '/' })
  jar.set(GSC_RETURN_COOKIE, '', { maxAge: 0, path: '/' })

  const returnTo = storedReturn && storedReturn.startsWith('/') && !storedReturn.startsWith('//') ? storedReturn : '/seo'
  const [storedState, storedOrg] = stored.split('.')
  const orgId = isOrgId(storedOrg) ? storedOrg : null
  // Land back in the tab's org, not whichever org is the user's default.
  const back = (key: string, value: string) => {
    const path = `${returnTo}${returnTo.includes('?') ? '&' : '?'}${key}=${value}`
    return NextResponse.redirect(new URL(orgId ? orgPath(orgId, path) : path, origin))
  }

  try {
    const user = await getUser()
    if (!user) return NextResponse.redirect(new URL('/', origin))

    const params = request.nextUrl.searchParams
    if (params.get('error')) return back('gsc_error', params.get('error') === 'access_denied' ? 'denied' : 'oauth')
    const code = params.get('code')
    if (!code) return back('gsc_error', 'missing_code')

    if (!storedState || storedState !== params.get('state') || !orgId) return back('gsc_error', 'csrf')

    // Pin the org the flow started in; refuse if the user is not a member of it.
    const supabase = await createClientForOrg(orgId)
    const { data: currentOrg } = await supabase.rpc('get_current_org_id')
    if (currentOrg !== orgId) return back('gsc_error', 'no_org')

    let tokens
    try {
      tokens = await exchangeGscCode(code, `${origin}${GSC_CALLBACK_PATH}`)
    } catch (err) {
      console.error('[gsc-callback] token exchange failed:', err)
      return back('gsc_error', 'token_exchange')
    }
    if (!grantedSearchConsole(tokens.scope)) return back('gsc_error', 'scope')

    const email = await fetchGoogleUserEmail(tokens.access_token)
    const blob: GscTokenBlob = { access_token: tokens.access_token, refresh_token: tokens.refresh_token ?? null }

    const { error } = await supabase.from('integrations').upsert(
      {
        organization_id: orgId,
        provider: 'google_search_console',
        name: 'Google Search Console',
        encrypted_api_key: await encrypt(JSON.stringify(blob)),
        key_hint: email,
        config: { token_expiry: new Date(Date.now() + tokens.expires_in * 1000).toISOString(), google_email: email },
        is_active: true,
        health_status: 'connected',
        last_error: null,
        failure_count: 0,
        last_checked_at: new Date().toISOString(),
      },
      { onConflict: 'organization_id,provider' },
    )
    if (error) {
      console.error('[gsc-callback] integrations upsert failed:', error.message)
      return back('gsc_error', 'db')
    }

    // Re-sync every linked site soon: a reconnect may follow an outage.
    await supabase.from('seo_sites').update({ gsc_next_sync_at: new Date().toISOString() }).not('gsc_property', 'is', null)

    return back('gsc', 'connected')
  } catch (err) {
    console.error('[gsc-callback] internal error:', err)
    return back('gsc_error', 'internal')
  }
}
