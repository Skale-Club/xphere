// Starts the Google Business Profile OAuth flow (scope business.manage).
// Requires local_seo.admin. The state cookie carries a CSRF token and where
// to send the operator back afterwards.

import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'

import { GBP_SCOPES } from '@/lib/gbp/client'
import { buildGoogleAuthUrl, GoogleAuthError } from '@/lib/google/oauth'
import { can } from '@/lib/rbac/server'
import { resolveRequestOrigin } from '@/lib/site-url'
import { getUser } from '@/lib/supabase/server'

export const runtime = 'nodejs'

const GBP_STATE_COOKIE = 'gbp_oauth_state'
const GBP_CALLBACK_PATH = '/api/local-seo/gbp/callback'

/** Only same-site dashboard paths may be returned to. */
function safeReturn(raw: string | null): string {
  return raw && raw.startsWith('/seo/local') && !raw.startsWith('//') ? raw : '/seo/local'
}

export async function GET(request: NextRequest): Promise<Response> {
  const origin = resolveRequestOrigin(request)
  const user = await getUser()
  if (!user) return NextResponse.redirect(new URL('/', origin))
  const returnTo = safeReturn(request.nextUrl.searchParams.get('return'))
  if (!(await can('local_seo.admin'))) {
    return NextResponse.redirect(new URL(`${returnTo}?gbp=forbidden`, origin))
  }

  const state = crypto.randomUUID()
  let url: string
  try {
    url = buildGoogleAuthUrl({ scopes: GBP_SCOPES, redirectPath: GBP_CALLBACK_PATH, state })
  } catch (err) {
    const code = err instanceof GoogleAuthError ? err.code : 'error'
    return NextResponse.redirect(new URL(`${returnTo}?gbp=${code}`, origin))
  }
  const jar = await cookies()
  jar.set(GBP_STATE_COOKIE, JSON.stringify({ state, returnTo }), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 600,
  })
  return NextResponse.redirect(url)
}
