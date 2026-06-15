import { NextRequest, NextResponse } from 'next/server'
import { randomBytes } from 'node:crypto'

import {
  META_ADS_OAUTH_STATE_COOKIE,
  META_ADS_OAUTH_STATE_MAX_AGE_SECONDS,
  buildMetaAdsAuthUrl,
} from '@/lib/ads/meta-oauth'
import { resolveRequestOrigin } from '@/lib/site-url'
import { getUser } from '@/lib/supabase/server'

export const runtime = 'nodejs'

export async function GET(request: NextRequest): Promise<Response> {
  const origin = resolveRequestOrigin(request)
  const user = await getUser()
  if (!user) return NextResponse.redirect(new URL('/', origin))

  if (user.email !== process.env.PLATFORM_ADMIN_EMAIL) {
    return NextResponse.redirect(new URL('/dashboard', origin))
  }

  const state = randomBytes(16).toString('hex')

  // buildMetaAdsAuthUrl throws when META_APP_ID / META_APP_SECRET are not set
  // (e.g. env vars not carried over to a new deploy). Without this guard the
  // route 500s before redirecting to Facebook, which reads as "connect just
  // stops working" with no clue why. Surface a readable error on /ads instead.
  let authUrl: string
  try {
    authUrl = buildMetaAdsAuthUrl(state)
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[ads/meta/connect:not-configured]', err instanceof Error ? err.message : err)
    return NextResponse.redirect(new URL('/ads?error=meta_not_configured', origin))
  }

  // Set the CSRF state cookie ON the redirect response. Cookies mutated via the
  // next/headers `cookies()` store are NOT attached to a manually constructed
  // NextResponse, so doing `cookies().set(...)` here would silently never set
  // the cookie → the callback finds no stored state → ?error=csrf.
  const res = NextResponse.redirect(authUrl)
  res.cookies.set(META_ADS_OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: META_ADS_OAUTH_STATE_MAX_AGE_SECONDS,
  })
  return res
}
