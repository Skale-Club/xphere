// Shared Bearer CRON_SECRET check for /api/cron/* routes that fail closed.
// Same contract as the sibling cron routes: 503 when the secret is not
// configured (the endpoint must never be public because an env var was
// forgotten), 401 when the header does not match.

export function authorizeCron(request: Request): Response | null {
  const CRON_SECRET = process.env.CRON_SECRET
  if (!CRON_SECRET) {
    return Response.json({ ok: false, error: 'CRON_SECRET not configured' }, { status: 503 })
  }
  const auth = request.headers.get('authorization') ?? ''
  if (auth !== `Bearer ${CRON_SECRET}`) {
    return Response.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  }
  return null
}

/** `?flag=1|true|yes` -> true. Anything else (or absent) -> false. */
export function boolParam(url: URL, name: string): boolean {
  const v = url.searchParams.get(name)
  return v === '1' || v === 'true' || v === 'yes'
}

/** Trimmed non-empty query param or null. */
export function strParam(url: URL, name: string): string | null {
  const v = url.searchParams.get(name)?.trim()
  return v ? v : null
}
