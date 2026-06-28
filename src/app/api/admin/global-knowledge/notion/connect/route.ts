import { randomBytes } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'

import {
  buildNotionAuthorizationUrl,
  NOTION_OAUTH_STATE_COOKIE,
  NOTION_OAUTH_STATE_MAX_AGE_SECONDS,
} from '@/lib/notion/client'
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

  const state = randomBytes(24).toString('hex')
  const response = NextResponse.redirect(buildNotionAuthorizationUrl(state))
  response.cookies.set(NOTION_OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: NOTION_OAUTH_STATE_MAX_AGE_SECONDS,
  })
  return response
}

