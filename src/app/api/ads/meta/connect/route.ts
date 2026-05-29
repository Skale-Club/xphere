import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'
import { randomBytes } from 'node:crypto'

import {
  META_ADS_OAUTH_STATE_COOKIE,
  META_ADS_OAUTH_STATE_MAX_AGE_SECONDS,
  buildMetaAdsAuthUrl,
} from '@/lib/ads/meta-oauth'
import { getUser } from '@/lib/supabase/server'

export const runtime = 'nodejs'

export async function GET(request: NextRequest): Promise<Response> {
  const user = await getUser()
  if (!user) return NextResponse.redirect(new URL('/', request.url))

  if (user.email !== process.env.PLATFORM_ADMIN_EMAIL) {
    return NextResponse.redirect(new URL('/dashboard', request.url))
  }

  const state = randomBytes(16).toString('hex')
  const jar = await cookies()
  jar.set(META_ADS_OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: META_ADS_OAUTH_STATE_MAX_AGE_SECONDS,
  })

  const authUrl = buildMetaAdsAuthUrl(state)
  return NextResponse.redirect(authUrl)
}
