import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'

import {
  GOOGLE_OAUTH_STATE_COOKIE,
  GOOGLE_OAUTH_STATE_MAX_AGE_SECONDS,
  buildGoogleOAuthUrl,
} from '@/lib/google-contacts/oauth'
import { getUser } from '@/lib/supabase/server'

export const runtime = 'nodejs'

export async function GET(request: NextRequest): Promise<Response> {
  const user = await getUser()

  if (!user) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  const state = crypto.randomUUID()
  const jar = await cookies()

  jar.set(GOOGLE_OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: GOOGLE_OAUTH_STATE_MAX_AGE_SECONDS,
  })

  const authUrl = buildGoogleOAuthUrl(state)

  return NextResponse.redirect(authUrl)
}
