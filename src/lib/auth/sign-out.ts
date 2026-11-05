import { clearBrowserToken } from '@/lib/supabase/client'

/**
 * Ends the application session and the Google one, and drops the browser's
 * cached Supabase token. The caller keeps its own navigation.
 *
 * The server call is first and is the only one allowed to fail the sign-out:
 * if the cookie is not revoked the person is still signed in and must be told.
 * Cleaning up the in-memory Firebase user is best-effort.
 */
export async function signOutEverywhere() {
  const response = await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' })
  if (!response.ok) throw new Error('Could not end your session. Please try again.')
  try {
    await (await import('@/lib/auth/google-identity-client')).signOutGoogleIdentity()
  } catch {
    console.warn('Google session cleanup could not finish')
  }
  clearBrowserToken()
}
