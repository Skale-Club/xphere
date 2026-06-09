import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'
import { getUser } from '@/lib/supabase/server'
import { resolveRequestOrigin } from '@/lib/site-url'

export const runtime = 'nodejs'

const CALENDAR_SCOPE =
  'https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/calendar.events'
const STATE_COOKIE = 'google_cal_oauth_state'
const RETURN_COOKIE = 'google_cal_oauth_return'

export async function GET(request: NextRequest): Promise<Response> {
  const CALLBACK_URI = `${resolveRequestOrigin(request)}/api/google/calendar-callback`
  const user = await getUser()
  if (!user) return NextResponse.redirect(new URL('/', request.url))

  const state = crypto.randomUUID()
  const jar = await cookies()
  jar.set(STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 600,
  })

  // Where to send the user after the callback. Only same-origin paths are
  // honored; anything else falls back to the default (/calendar).
  const requestedReturn = request.nextUrl.searchParams.get('return')
  if (requestedReturn && requestedReturn.startsWith('/') && !requestedReturn.startsWith('//')) {
    jar.set(RETURN_COOKIE, requestedReturn, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: 600,
    })
  }

  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth')
  url.searchParams.set('client_id', process.env.GOOGLE_CALENDAR_CLIENT_ID!)
  url.searchParams.set('redirect_uri', CALLBACK_URI)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', CALENDAR_SCOPE)
  url.searchParams.set('state', state)
  url.searchParams.set('access_type', 'offline')
  url.searchParams.set('prompt', 'consent') // force to always get refresh_token

  return NextResponse.redirect(url.toString())
}
