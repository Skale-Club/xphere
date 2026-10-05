// Start the Google Search Console OAuth handshake (SEO module, phase 2).
//
// Reuses the platform Google OAuth client (GOOGLE_CLIENT_ID) as a separate
// grant — see src/lib/seo/gsc/oauth.ts. The tab's org is captured here (this
// GET carries the org-pinned Referer) and stored next to the CSRF state,
// because Google's redirect back to the callback carries no org signal.

import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'
import { createClient, getUser } from '@/lib/supabase/server'
import { can } from '@/lib/rbac/server'
import { resolveRequestOrigin } from '@/lib/site-url'
import {
  GSC_CALLBACK_PATH,
  GSC_RETURN_COOKIE,
  GSC_STATE_COOKIE,
  GSC_STATE_MAX_AGE_SECONDS,
  buildGscAuthUrl,
} from '@/lib/seo/gsc/oauth'

export const runtime = 'nodejs'

const COOKIE = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production',
  path: '/',
  maxAge: GSC_STATE_MAX_AGE_SECONDS,
}

export async function GET(request: NextRequest): Promise<Response> {
  const origin = resolveRequestOrigin(request)
  const user = await getUser()
  if (!user) return NextResponse.redirect(`${origin}/`)

  const requested = request.nextUrl.searchParams.get('return')
  const returnTo = requested && requested.startsWith('/') && !requested.startsWith('//') ? requested : '/seo'

  if (!(await can('seo.manage')) && !(await can('integrations.manage'))) {
    return NextResponse.redirect(`${origin}${withParam(returnTo, 'gsc_error', 'forbidden')}`)
  }

  const supabase = await createClient()
  const { data: orgId } = await supabase.rpc('get_current_org_id')
  if (!orgId) return NextResponse.redirect(`${origin}${withParam(returnTo, 'gsc_error', 'no_org')}`)

  const state = crypto.randomUUID()
  const jar = await cookies()
  // state.orgId — the callback verifies the state, then pins this org.
  jar.set(GSC_STATE_COOKIE, `${state}.${orgId}`, COOKIE)
  jar.set(GSC_RETURN_COOKIE, returnTo, COOKIE)

  try {
    return NextResponse.redirect(buildGscAuthUrl(`${origin}${GSC_CALLBACK_PATH}`, state))
  } catch (err) {
    console.error('[gsc-connect] cannot build auth url:', err)
    return NextResponse.redirect(`${origin}${withParam(returnTo, 'gsc_error', 'not_configured')}`)
  }
}

function withParam(path: string, key: string, value: string) {
  return `${path}${path.includes('?') ? '&' : '?'}${key}=${value}`
}
