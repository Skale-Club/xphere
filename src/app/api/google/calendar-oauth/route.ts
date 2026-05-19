import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'
import { getUser } from '@/lib/supabase/server'

export const runtime = 'nodejs'

const CALENDAR_SCOPE =
  'https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/calendar.events'
const CALLBACK_URI = `${process.env.NEXT_PUBLIC_SITE_URL ?? 'https://xphere.skale.club'}/api/google/calendar-callback`
const STATE_COOKIE = 'google_cal_oauth_state'

export async function GET(request: NextRequest): Promise<Response> {
  const user = await getUser()
  if (!user) return NextResponse.redirect(new URL('/login', request.url))

  const state = crypto.randomUUID()
  const jar = await cookies()
  jar.set(STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 600,
  })

  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth')
  url.searchParams.set('client_id', process.env.GOOGLE_CLIENT_ID!)
  url.searchParams.set('redirect_uri', CALLBACK_URI)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', CALENDAR_SCOPE)
  url.searchParams.set('state', state)
  url.searchParams.set('access_type', 'offline')
  url.searchParams.set('prompt', 'consent') // force to always get refresh_token

  return NextResponse.redirect(url.toString())
}
