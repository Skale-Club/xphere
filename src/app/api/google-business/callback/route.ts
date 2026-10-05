import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'

import { encrypt } from '@/lib/crypto'
import {
  exchangeGoogleBusinessCode,
  formatGoogleBusinessAddress,
  GOOGLE_BUSINESS_OAUTH_STATE_COOKIE,
  listGoogleBusinessAccounts,
  listGoogleBusinessLocations,
  serializeGoogleBusinessTokens,
} from '@/lib/google-business/oauth'
import { resolveRequestOrigin } from '@/lib/site-url'
import { createClient, getUser } from '@/lib/supabase/server'

export const runtime = 'nodejs'

const COOKIE_CLEAR = { httpOnly: true, sameSite: 'lax' as const, secure: process.env.NODE_ENV === 'production', path: '/', maxAge: 0 }

function redirect(request: NextRequest, path: string) {
  const response = NextResponse.redirect(new URL(path, resolveRequestOrigin(request)))
  response.cookies.set(GOOGLE_BUSINESS_OAUTH_STATE_COOKIE, '', COOKIE_CLEAR)
  return response
}

export async function GET(request: NextRequest): Promise<Response> {
  if (!await getUser()) return redirect(request, '/')
  const url = new URL(request.url)
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  const storedState = (await cookies()).get(GOOGLE_BUSINESS_OAUTH_STATE_COOKIE)?.value
  if (!code) return redirect(request, '/integrations/google-reviews?gbp_error=missing_code')
  if (!state || !storedState || state !== storedState) return redirect(request, '/integrations/google-reviews?gbp_error=csrf')

  const supabase = await createClient()
  const { data: orgId } = await supabase.rpc('get_current_org_id')
  if (!orgId) return redirect(request, '/integrations/google-reviews?gbp_error=no_org')

  try {
    const tokens = await exchangeGoogleBusinessCode(code)
    const accounts = await listGoogleBusinessAccounts(tokens.access_token)
    const discovered = []
    for (const account of accounts) {
      if (!account.name) continue
      const locations = await listGoogleBusinessLocations(account.name, tokens.access_token)
      for (const location of locations) {
        if (!location.name) continue
        discovered.push({ account, location })
      }
    }
    if (!discovered.length) return redirect(request, '/integrations/google-reviews?gbp_error=no_locations')

    const { data: existing } = await supabase
      .from('ads_connections')
      .select('ad_account_id, status')
      .eq('platform', 'google_business')
    const existingStatus = new Map((existing ?? []).map((row) => [row.ad_account_id, row.status]))
    const hasActive = (existing ?? []).some((row) => row.status === 'active')
    const encrypted = await encrypt(serializeGoogleBusinessTokens(tokens))
    const now = new Date().toISOString()
    const rows = discovered.map(({ account, location }, index) => {
      const target = `${account.name}/${location.name}`
      return {
        org_id: orgId as string,
        platform: 'google_business' as const,
        ad_account_id: target,
        ad_account_name: location.title ?? `${account.accountName ?? account.name} · ${formatGoogleBusinessAddress(location.storefrontAddress) ?? location.name}`,
        encrypted_access_token: encrypted,
        // The refresh token is the durable credential. Storing the one-hour
        // access-token expiry would make the ads expiry watcher report a false
        // disconnection, exactly as older Google Ads connections once did.
        token_expires_at: null,
        status: existingStatus.get(target) ?? (!hasActive && index === 0 ? 'active' : 'available'),
        health: 'ok' as const,
        connection_error: null,
        last_error_at: null,
        last_verified_at: now,
        meta_app_scoped_user_id: null,
      }
    })
    const { error } = await supabase.from('ads_connections').upsert(rows, { onConflict: 'org_id,platform,ad_account_id' })
    if (error) throw new Error(error.message)
    return redirect(request, '/integrations/google-reviews?gbp_connected=true')
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown OAuth error'
    if (message.includes('refresh_token')) return redirect(request, '/integrations/google-reviews?gbp_error=no_refresh_token')
    return redirect(request, `/integrations/google-reviews?gbp_error=oauth_exchange&detail=${encodeURIComponent(message.slice(0, 300))}`)
  }
}
