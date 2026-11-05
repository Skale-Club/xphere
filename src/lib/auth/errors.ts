/**
 * User-facing copy for every way sign-in can fail. Every failure explains
 * itself in the dialog: a silent bounce to a bare landing page reads as "my
 * login didn't work" and invites a second sign-in (the duplicate-session bug
 * this flow was built to avoid).
 *
 * Codes come from two places: `googlePhoneError()` (Firebase SDK failures in
 * the browser) and the `code` field of POST /api/auth/identity errors.
 */
export type SignInErrorCode =
  // Browser / Firebase
  | 'invalid_phone'
  | 'wrong_code'
  | 'too_many_codes'
  | 'sms_failed'
  | 'popup_closed'
  // POST /api/auth/identity
  | 'origin_denied'
  | 'rate_limited'
  | 'auth_unavailable'
  | 'invalid_token'
  | 'generic'

const MESSAGES: Record<SignInErrorCode, string> = {
  invalid_phone: 'Enter a valid phone number, including the country.',
  wrong_code: 'That code is not right or has expired. Check it or request a new one.',
  too_many_codes: 'Too many codes were requested for this number. Try again later.',
  sms_failed: 'We could not send the code. Check your connection and try again.',
  popup_closed: 'The Google window was closed before sign-in finished. Please try again.',
  origin_denied: 'Sign-in is not available from this address. Use xphere.app and try again.',
  rate_limited: 'Too many attempts. Wait a minute and try again.',
  auth_unavailable: 'Sign-in is temporarily unavailable. Please try again in a few minutes.',
  invalid_token: 'We could not verify your sign-in. Please try again.',
  generic: 'Something went wrong. Please try again.',
}

export const NO_WORKSPACE_MESSAGE =
  'Your account is not part of any workspace yet. Ask an administrator to invite you.'

export const GOOGLE_NEEDS_PHONE_MESSAGE = 'Confirm your phone number to link this Google account.'

export function signInErrorMessage(code: string | null | undefined): string {
  return code && Object.prototype.hasOwnProperty.call(MESSAGES, code)
    ? MESSAGES[code as SignInErrorCode]
    : MESSAGES.generic
}
