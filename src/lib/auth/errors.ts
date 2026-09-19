/**
 * Maps Supabase auth error messages into user-friendly strings.
 * Shared between client-side dialog display and server action returns.
 */
export function mapSupabaseError(message: string): string {
  if (message.includes('Invalid login credentials')) {
    return 'Invalid email or password. Check your credentials and try again.'
  }
  const lower = message.toLowerCase()
  if (lower.includes('network') || lower.includes('fetch')) {
    return 'Unable to connect. Check your internet connection and try again.'
  }
  if (lower.includes('disabled') || lower.includes('banned')) {
    return 'This account has been disabled. Contact your administrator.'
  }
  return message
}

/**
 * Stable error codes returned by the auth server actions.
 * The dialog maps these to user-facing copy.
 */
export type AuthErrorCode = 'unknown_error'

export function authErrorCodeToMessage(code: AuthErrorCode): string {
  switch (code) {
    case 'unknown_error':
    default:
      return 'Something went wrong. Please try again.'
  }
}

/* -------------------------------------------------------------------------- */
/*  OAuth round-trip failures                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Query param used to carry an OAuth failure from /auth/callback back to the
 * landing page so the login dialog can explain what happened.
 *
 * WHY THIS EXISTS: every failure path in the callback used to `redirect('/')`
 * with no explanation. The user lands back on the marketing page, reads it as
 * "my login didn't work", and signs in again — which is exactly the duplicate
 * sign-in we were chasing (production logs, 2026-09-09 13:36 UTC: an expired
 * OAuth state bounced silently to `/`, followed by three sign-ins in 12 s).
 */
export const AUTH_ERROR_PARAM = 'auth_error'

export type OAuthFailureCode =
  | 'oauth_state_expired'
  | 'oauth_cancelled'
  | 'oauth_failed'
  | 'exchange_failed'
  | 'no_org'

const OAUTH_FAILURE_MESSAGES: Record<OAuthFailureCode, string> = {
  oauth_state_expired:
    'Your sign-in took too long and the link expired. Please sign in again.',
  oauth_cancelled: 'Sign-in was cancelled before it finished. Please try again.',
  oauth_failed:
    'We could not complete sign-in with that provider. Please try again.',
  exchange_failed: 'We could not finish signing you in. Please try again.',
  no_org:
    'Your account is not part of any workspace yet. Ask an administrator to invite you.',
}

export function isOAuthFailureCode(
  value: string | null | undefined,
): value is OAuthFailureCode {
  return !!value && Object.prototype.hasOwnProperty.call(OAUTH_FAILURE_MESSAGES, value)
}

/** User-facing copy for a failure code, or null when the code is unknown. */
export function oauthFailureToMessage(code: string | null | undefined): string | null {
  return isOAuthFailureCode(code) ? OAUTH_FAILURE_MESSAGES[code] : null
}

/**
 * Classify the `error` / `error_code` / `error_description` params Supabase
 * appends to the callback URL when the provider round-trip fails.
 */
export function classifyOAuthCallbackError(
  error: string | null,
  errorCode: string | null,
  description: string | null,
): OAuthFailureCode {
  const haystack = `${error ?? ''} ${errorCode ?? ''} ${description ?? ''}`.toLowerCase()
  if (haystack.includes('state') && (haystack.includes('expired') || haystack.includes('invalid'))) {
    return 'oauth_state_expired'
  }
  if (haystack.includes('access_denied') || haystack.includes('cancel')) {
    return 'oauth_cancelled'
  }
  return 'oauth_failed'
}
