import { randomBytes } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'

import {
  buildGoogleBusinessAuthUrl,
  GOOGLE_BUSINESS_OAUTH_STATE_COOKIE,
  GOOGLE_BUSINESS_OAUTH_STATE_MAX_AGE_SECONDS,
} from '@/lib/google-business/oauth'
import { resolveRequestOrigin } from '@/lib/site-url'
import { getUser } from '@/lib/supabase/server'

export const runtime = 'nodejs'

export async function GET(request: NextRequest): Promise<Response> {
  if (!await getUser()) return NextResponse.redirect(new URL('/', resolveRequestOrigin(request)))
  const state = randomBytes(16).toString('hex')
  const response = NextResponse.redirect(buildGoogleBusinessAuthUrl(state))
  response.cookies.set(GOOGLE_BUSINESS_OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: GOOGLE_BUSINESS_OAUTH_STATE_MAX_AGE_SECONDS,
  })
  return response
}
