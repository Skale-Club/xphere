export const runtime = 'nodejs'
// Lightweight liveness probe — no auth, no DB query, no caching.
// Used by Docker HEALTHCHECK and Coolify health check to confirm the
// Node.js process is up and the HTTP server is accepting connections.
export function GET() {
  return Response.json({ ok: true }, {
    headers: { 'Cache-Control': 'no-store' },
  })
}
