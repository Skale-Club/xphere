// Cookie name and options only. Kept apart from session.ts because that file is
// server-only and imports the database client, while src/proxy.ts needs just
// these constants to re-issue the cookie.

export const SESSION_COOKIE = 'xphere_session'

/** 30 days, rolling: every active day pushes the expiry out again. */
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  }
}
