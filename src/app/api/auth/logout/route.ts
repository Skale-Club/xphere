import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { isSameAuthOrigin } from '@/lib/auth/same-origin'
import { destroySession, SESSION_COOKIE } from '@/lib/auth/session'
import { ACTIVE_ORG_COOKIE } from '@/lib/auth/post-login'

export const runtime = 'nodejs'

export async function POST(request: Request) {
  if (!isSameAuthOrigin(request)) {
    return NextResponse.json({ code: 'origin_denied' }, { status: 403, headers: { 'Cache-Control': 'no-store' } })
  }

  const cookieStore = await cookies()
  const token = cookieStore.get(SESSION_COOKIE)?.value

  let destroyed = true
  if (token) {
    try {
      await destroySession(token)
    } catch (err) {
      destroyed = false
      console.error('[auth/logout] could not delete session row:', err instanceof Error ? err.message : 'error')
    }
  }

  // The cookies go either way: this browser is signed out even if the row delete failed.
  const res = NextResponse.json(destroyed ? { ok: true } : { ok: false }, {
    status: destroyed ? 200 : 500,
    headers: { 'Cache-Control': 'no-store' },
  })
  res.cookies.set(SESSION_COOKIE, '', { path: '/', maxAge: 0 })
  res.cookies.set(ACTIVE_ORG_COOKIE, '', { path: '/', maxAge: 0 })
  return res
}
