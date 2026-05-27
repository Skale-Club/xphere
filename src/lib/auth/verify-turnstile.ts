/**
 * Cloudflare Turnstile server-side verification.
 *
 * Required env vars (set by user, not by this plan):
 *   NEXT_PUBLIC_TURNSTILE_SITE_KEY — public site key (consumed by the React widget)
 *   TURNSTILE_SECRET_KEY           — server-side secret (consumed by this helper)
 *
 * Both keys are issued from the Cloudflare dashboard:
 *   https://dash.cloudflare.com -> Turnstile -> Add site.
 */

const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'

export async function verifyTurnstile(
  token: string | null | undefined,
  remoteIp?: string | null,
): Promise<{ success: boolean }> {
  const secret = process.env.TURNSTILE_SECRET_KEY
  if (!secret) return { success: true }
  if (!token) return { success: false }
  try {
    const body = new URLSearchParams({ secret, response: token })
    if (remoteIp) body.set('remoteip', remoteIp)
    const res = await fetch(VERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    })
    if (!res.ok) return { success: false }
    const data = (await res.json()) as { success?: boolean }
    return { success: data.success === true }
  } catch {
    return { success: false }
  }
}
