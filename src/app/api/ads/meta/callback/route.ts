import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'

import { encrypt } from '@/lib/crypto'
import {
  META_ADS_OAUTH_STATE_COOKIE,
  exchangeCodeForShortLivedToken,
  exchangeShortLivedTokenForLongLivedToken,
  fetchMetaAdsAdAccounts,
  fetchMetaUserScopedId,
} from '@/lib/ads/meta-oauth'
import { createClient, getUser } from '@/lib/supabase/server'

export const runtime = 'nodejs'

const COOKIE_CLEAR = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production',
  path: '/',
  maxAge: 0,
}

function redirect(request: NextRequest, path: string) {
  return NextResponse.redirect(new URL(path, request.url))
}

export async function GET(request: NextRequest): Promise<Response> {
  const user = await getUser()
  if (!user) return redirect(request, '/')

  // Admin gate — only PLATFORM_ADMIN can connect ad accounts
  if (user.email !== process.env.PLATFORM_ADMIN_EMAIL) {
    return redirect(request, '/dashboard')
  }

  const url = new URL(request.url)
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  const jar = await cookies()
  const storedState = jar.get(META_ADS_OAUTH_STATE_COOKIE)?.value

  // Always clear the state cookie
  jar.set(META_ADS_OAUTH_STATE_COOKIE, '', COOKIE_CLEAR)

  if (!code) return redirect(request, '/ads?error=missing_code')

  if (!state || !storedState || state !== storedState) {
    return redirect(request, '/ads?error=csrf')
  }

  const supabase = await createClient()
  const { data: orgId } = await supabase.rpc('get_current_org_id')
  if (!orgId) return redirect(request, '/ads?error=no_org')

  try {
    const shortToken = await exchangeCodeForShortLivedToken(code)
    const longToken = await exchangeShortLivedTokenForLongLivedToken(shortToken.access_token)
    const [adAccounts, userId] = await Promise.all([
      fetchMetaAdsAdAccounts(longToken.access_token),
      fetchMetaUserScopedId(longToken.access_token),
    ])

    if (adAccounts.length === 0) {
      return redirect(request, '/ads?error=no_ad_accounts')
    }

    const encryptedToken = await encrypt(longToken.access_token)
    const expiresAt = longToken.expires_in
      ? new Date(Date.now() + longToken.expires_in * 1000).toISOString()
      : null

    const rows = adAccounts.map((account) => ({
      org_id: orgId as string,
      platform: 'meta' as const,
      ad_account_id: account.id,
      ad_account_name: account.name,
      encrypted_access_token: encryptedToken,
      token_expires_at: expiresAt,
      status: 'active' as const,
      connection_error: null,
      meta_app_scoped_user_id: userId,
    }))

    const { error } = await supabase
      .from('ads_connections')
      .upsert(rows, { onConflict: 'org_id,platform,ad_account_id' })

    if (error) throw new Error(error.message)

    return redirect(request, '/ads?connected=true')
  } catch {
    return redirect(request, '/ads?error=oauth_exchange')
  }
}
