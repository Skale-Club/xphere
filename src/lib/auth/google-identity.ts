import 'server-only'
import { createRemoteJWKSet, jwtVerify } from 'jose'

// Firebase / Identity Platform ID tokens are signed with Google's securetoken keys.
const keys = createRemoteJWKSet(
  new URL('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com'),
)

export interface GoogleIdentity {
  uid: string
  phone?: string
  email?: string
  name?: string
  provider: 'google.com' | 'phone'
}

export function googleAuthConfig() {
  const projectId = process.env.GOOGLE_AUTH_PROJECT_ID
  const apiKey = process.env.FIREBASE_API_KEY
  const authDomain = process.env.FIREBASE_AUTH_DOMAIN
  const googleClientId = process.env.GOOGLE_WEB_CLIENT_ID
  const enabled = process.env.GOOGLE_AUTH_ENABLED === 'true'
  if (enabled && (!projectId || !apiKey || !authDomain || !googleClientId)) {
    throw new Error('Google authentication configuration is incomplete')
  }
  return { enabled, projectId, apiKey, authDomain, googleClientId }
}

/** Validate signature, audience and issuer before using any profile attributes. */
export async function verifyGoogleIdentity(token: string): Promise<GoogleIdentity> {
  const { projectId, enabled } = googleAuthConfig()
  if (!enabled || !projectId) throw new Error('Google authentication is not enabled')
  const { payload } = await jwtVerify(token, keys, {
    algorithms: ['RS256'],
    audience: projectId,
    issuer: `https://securetoken.google.com/${projectId}`,
    requiredClaims: ['sub', 'iat', 'exp', 'auth_time'],
    maxTokenAge: '65m',
  })
  return identityFromVerifiedClaims(payload)
}

/** Accepts only claims already verified by jwtVerify above. */
export function identityFromVerifiedClaims(claims: Record<string, unknown>): GoogleIdentity {
  const firebase = claims.firebase as { sign_in_provider?: string; tenant?: string } | undefined
  const provider = firebase?.sign_in_provider
  if (
    !claims.sub ||
    typeof claims.sub !== 'string' ||
    claims.sub.length > 128 ||
    firebase?.tenant ||
    !['google.com', 'phone'].includes(provider ?? '')
  ) {
    throw new Error('Unsupported Google identity')
  }
  const phone =
    typeof claims.phone_number === 'string' && /^\+[1-9]\d{7,14}$/.test(claims.phone_number)
      ? claims.phone_number
      : undefined
  // An unverified email is attacker-controlled, so it is dropped rather than trusted.
  const email = claims.email_verified === true && typeof claims.email === 'string' ? claims.email : undefined
  if (provider === 'phone' && !phone) throw new Error('Verified phone is required')
  return {
    uid: claims.sub,
    provider: provider as GoogleIdentity['provider'],
    phone,
    email,
    name: typeof claims.name === 'string' ? claims.name : undefined,
  }
}
