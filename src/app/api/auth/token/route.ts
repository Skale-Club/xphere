import { NextResponse } from 'next/server'
import { getUser } from '@/lib/supabase/server'
import { mintSupabaseJwt } from '@/lib/auth/supabase-jwt'

export const runtime = 'nodejs'

const NO_STORE = { 'Cache-Control': 'no-store' }

/**
 * Short-lived Supabase JWT for the browser client (PostgREST, Storage, Realtime).
 * `expiresAt` is in seconds, like the JWT `exp` claim.
 */
export async function GET() {
  const user = await getUser()
  if (!user) return NextResponse.json({ token: null }, { status: 401, headers: NO_STORE })
  try {
    const { token, expiresAt } = await mintSupabaseJwt(user)
    return NextResponse.json({ token, expiresAt }, { headers: NO_STORE })
  } catch (err) {
    console.error('[auth/token] could not mint token:', err instanceof Error ? err.message : 'error')
    return NextResponse.json({ token: null }, { status: 500, headers: NO_STORE })
  }
}
