import { NextRequest, NextResponse } from 'next/server'

import { resolveRequestOrigin } from '@/lib/site-url'

export async function GET(request: NextRequest) {
  const incoming = new URL(request.url)
  const code = incoming.searchParams.get('code')

  if (!code) {
    return NextResponse.redirect(`${resolveRequestOrigin(request)}/`)
  }

  const callbackUrl = new URL('/auth/callback', resolveRequestOrigin(request))
  incoming.searchParams.forEach((value, key) => {
    callbackUrl.searchParams.append(key, value)
  })
  if (!callbackUrl.searchParams.has('next')) {
    callbackUrl.searchParams.set('next', '/dashboard')
  }

  return NextResponse.redirect(callbackUrl)
}
