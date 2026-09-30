// src/lib/request-ip.ts
// Shared client-IP extraction for public routes behind the reverse proxy.
//
// The LEFT end of x-forwarded-for is whatever the client sent, so reading it
// let anyone pick their own rate-limit bucket (and, with IP bans, frame someone
// else). resolveClientIp walks the chain from the right instead, skipping our
// own proxy hops, and trusts CF-Connecting-IP only when the peer really is a
// Cloudflare edge — hosts are not guaranteed to sit behind Cloudflare.
import { clientIpFromHeaders } from '@/lib/security/bot-defense'

export function getClientIp(request: Request): string {
  return clientIpFromHeaders(request.headers) ?? 'unknown'
}

/** Same resolution for code that only has a Headers-like object (server actions). */
export function getClientIpFromHeaders(headers: { get(name: string): string | null }): string {
  return clientIpFromHeaders(headers) ?? 'unknown'
}
