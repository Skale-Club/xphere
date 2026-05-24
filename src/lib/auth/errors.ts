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
export type AuthErrorCode = 'captcha_failed' | 'unknown_error'

export function authErrorCodeToMessage(code: AuthErrorCode): string {
  switch (code) {
    case 'captcha_failed':
      return 'Captcha verification failed. Please try again.'
    case 'unknown_error':
    default:
      return 'Something went wrong. Please try again.'
  }
}
