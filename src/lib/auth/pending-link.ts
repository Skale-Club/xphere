import 'server-only'
import { jwtVerify, SignJWT } from 'jose'
import type { IdentityBinding } from '@/lib/auth/identities'

/**
 * A Google sign-in that matched no account has to be proven with a texted code
 * before it is linked. The Google identity waits in this short-lived signed
 * cookie in the meantime (Xpot keeps it in its server-side session).
 */
export const PENDING_LINK_COOKIE = 'xphere_pending_google'
const PENDING_LINK_TTL_SECONDS = 10 * 60

function secret(): Uint8Array {
  const value = process.env.SESSION_SECRET
  if (!value) throw new Error('SESSION_SECRET is not set')
  return new TextEncoder().encode(value)
}

export async function signPendingLink(binding: IdentityBinding): Promise<string> {
  return new SignJWT({ projectId: binding.projectId, uid: binding.uid })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${PENDING_LINK_TTL_SECONDS}s`)
    .sign(secret())
}

export async function readPendingLink(token: string | null | undefined): Promise<IdentityBinding | null> {
  if (!token) return null
  try {
    const { payload } = await jwtVerify(token, secret(), { algorithms: ['HS256'] })
    if (typeof payload.projectId !== 'string' || typeof payload.uid !== 'string') return null
    return { projectId: payload.projectId, uid: payload.uid }
  } catch {
    // Expired, tampered or unreadable: treat as no pending link.
    return null
  }
}

export function pendingLinkCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    maxAge: PENDING_LINK_TTL_SECONDS,
  }
}
