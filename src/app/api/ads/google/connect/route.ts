import { NextRequest, NextResponse } from 'next/server'
import { randomBytes } from 'node:crypto'

import {
  GOOGLE_ADS_OAUTH_STATE_COOKIE,
  GOOGLE_ADS_OAUTH_STATE_MAX_AGE_SECONDS,
  buildGoogleAdsAuthUrl,
} from '@/lib/ads/google-oauth'
import { resolveRequestOrigin } from '@/lib/site-url'
import { getUser } from '@/lib/supabase/server'

export const runtime = 'nodejs'

export async function GET(request: NextRequest): Promise<Response> {
  const origin = resolveRequestOrigin(request)
  const user = await getUser()
  if (!user) return NextResponse.redirect(new URL('/', origin))

  const state = randomBytes(16).toString('hex')
  const authUrl = buildGoogleAdsAuthUrl(state)

  // Set the CSRF state cookie on the response (a manually returned
  // NextResponse does not pick up cookies() mutations).
  const res = NextResponse.redirect(authUrl)
  res.cookies.set(GOOGLE_ADS_OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: GOOGLE_ADS_OAUTH_STATE_MAX_AGE_SECONDS,
  })
  return res
}
