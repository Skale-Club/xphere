import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'

import { encrypt } from '@/lib/crypto'
import {
  GOOGLE_ADS_OAUTH_STATE_COOKIE,
  exchangeCodeForTokens,
  listAccessibleCustomers,
  getCustomerInfo,
} from '@/lib/ads/google-oauth'
import { serializeTokens } from '@/lib/ads/google-api'
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
  if (user.email !== process.env.PLATFORM_ADMIN_EMAIL) return redirect(request, '/dashboard')

  const url = new URL(request.url)
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  const jar = await cookies()
  const storedState = jar.get(GOOGLE_ADS_OAUTH_STATE_COOKIE)?.value

  jar.set(GOOGLE_ADS_OAUTH_STATE_COOKIE, '', COOKIE_CLEAR)

  if (!code) return redirect(request, '/ads/google?error=missing_code')
  if (!state || !storedState || state !== storedState) return redirect(request, '/ads/google?error=csrf')

  const supabase = await createClient()
  const { data: orgId } = await supabase.rpc('get_current_org_id')
  if (!orgId) return redirect(request, '/ads/google?error=no_org')

  try {
    const tokens = await exchangeCodeForTokens(code)
    const customerIds = await listAccessibleCustomers(tokens.access_token)

    if (!customerIds.length) return redirect(request, '/ads/google?error=no_ad_accounts')

    // Fetch info for all customers (cap at 10 to avoid slow callbacks)
    const customers = await Promise.all(
      customerIds.slice(0, 10).map((id) => getCustomerInfo(id, tokens.access_token).catch(() => null)),
    )

    const encryptedTokens = await encrypt(serializeTokens(tokens))
    const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString()

    const rows = customers
      .filter((c): c is NonNullable<typeof c> => c !== null)
      .map((c) => ({
        org_id: orgId as string,
        platform: 'google' as const,
        ad_account_id: c.id,
        ad_account_name: c.name,
        encrypted_access_token: encryptedTokens,
        token_expires_at: expiresAt,
        status: 'active' as const,
        connection_error: null,
        meta_app_scoped_user_id: null,
      }))

    if (!rows.length) return redirect(request, '/ads/google?error=no_ad_accounts')

    const { error } = await supabase
      .from('ads_connections')
      .upsert(rows, { onConflict: 'org_id,platform,ad_account_id' })

    if (error) throw new Error(error.message)

    return redirect(request, '/ads/google?connected=true')
  } catch (e) {
    const msg = e instanceof Error ? e.message : ''
    if (msg.includes('refresh_token')) return redirect(request, '/ads/google?error=no_refresh_token')
    return redirect(request, '/ads/google?error=oauth_exchange')
  }
}
