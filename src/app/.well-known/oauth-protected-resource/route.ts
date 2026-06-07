// RFC 9728 — OAuth 2.0 Protected Resource Metadata.
// Returned in WWW-Authenticate from /api/mcp when no/invalid token is sent.
// Tells MCP clients which authorization server protects this resource.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

import { getBaseUrl } from '@/lib/billing/context'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS })
}

export async function GET(_request: Request) {
  const origin = await getBaseUrl()
  return Response.json(
    {
      resource: `${origin}/api/mcp`,
      authorization_servers: [origin],
      bearer_methods_supported: ['header'],
      scopes_supported: ['mcp:all'],
    },
    { headers: CORS_HEADERS },
  )
}
