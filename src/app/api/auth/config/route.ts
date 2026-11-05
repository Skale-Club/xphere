import { NextResponse } from 'next/server'
import { googleAuthConfig } from '@/lib/auth/google-identity'
import { countryIsoFromHeaders } from '@/lib/auth/phone'

export const runtime = 'nodejs'

/**
 * Public sign-in configuration for the browser SDK. The Firebase web API key is
 * not a secret (it ships in every Firebase web app); access is enforced by
 * authorized domains and by verifying ID tokens on the server.
 */
export async function GET(request: Request) {
  const headers = { 'Cache-Control': 'no-store' }
  let config: ReturnType<typeof googleAuthConfig>
  try {
    config = googleAuthConfig()
  } catch (err) {
    console.error('[auth/config]', err instanceof Error ? err.message : 'configuration error')
    return NextResponse.json({ provider: 'disabled' }, { headers })
  }
  if (!config.enabled) return NextResponse.json({ provider: 'disabled' }, { headers })
  return NextResponse.json(
    {
      provider: 'google',
      google: {
        enabled: true,
        projectId: config.projectId,
        apiKey: config.apiKey,
        authDomain: config.authDomain,
        googleClientId: config.googleClientId,
      },
      // Only picks the default country in the phone field; never trusted for anything else.
      countryIso: countryIsoFromHeaders(request.headers),
    },
    { headers },
  )
}
