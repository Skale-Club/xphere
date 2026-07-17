// src/lib/request-ip.ts
// Shared client-IP extraction for public routes behind the reverse proxy.
// First hop of x-forwarded-for is the client (Traefik appends, client-supplied
// values are leftmost — good enough for rate-limit keying, not for auth).
export function getClientIp(request: Request): string {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
}
