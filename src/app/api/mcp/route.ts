// Unified MCP endpoint | speaks JSON-RPC 2.0 over Streamable HTTP (web-standard).
//
//   POST /api/mcp   | JSON-RPC requests (initialize, tools/list, tools/call, ...)
//   GET  /api/mcp   | not used in stateless mode | returns metadata
//   OPTIONS         | CORS preflight | required for browser-based MCP clients
//
// Auth: Authorization: Bearer <token>
//   - xph_... → legacy project_mcp_tokens table
//   - opaque    → mcp_oauth_tokens table (issued via /api/mcp/oauth/token)
//
// When unauthenticated, returns 401 with WWW-Authenticate so OAuth-aware clients
// (Claude, ChatGPT) can discover the resource metadata and start the flow.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { authenticateMcpRequest } from '@/lib/mcp/auth'
import { createXphereMcpServer } from '@/lib/mcp/server'
import { ALL_MCP_TOOLS } from '@/lib/mcp/registry'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, Mcp-Session-Id, MCP-Protocol-Version',
  'Access-Control-Expose-Headers': 'Mcp-Session-Id, WWW-Authenticate',
}

function withCors(res: Response): Response {
  const headers = new Headers(res.headers)
  for (const [k, v] of Object.entries(CORS_HEADERS)) headers.set(k, v)
  return new Response(res.body, { status: res.status, headers })
}

function unauthorizedResponse(request: Request): Response {
  // Per RFC 9728 / MCP spec: tell the client where to find resource metadata
  // so it can discover the authorization server and start the OAuth flow.
  const origin = new URL(request.url).origin
  const metadataUrl = `${origin}/.well-known/oauth-protected-resource`
  const wwwAuth = `Bearer realm="xphere-mcp", resource_metadata="${metadataUrl}"`
  return new Response(
    JSON.stringify({
      jsonrpc: '2.0',
      error: { code: -32001, message: 'Unauthorized' },
      id: null,
    }),
    {
      status: 401,
      headers: {
        ...CORS_HEADERS,
        'Content-Type': 'application/json',
        'WWW-Authenticate': wwwAuth,
      },
    },
  )
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS })
}

export async function GET(request: Request) {
  // Discovery / health response. The real MCP traffic comes over POST.
  // Streamable HTTP allows GET for server-initiated SSE, but in stateless mode
  // we just expose metadata.
  return withCors(Response.json({
    name: 'xphere-mcp',
    version: '1.0.0',
    protocol: 'MCP Streamable HTTP',
    auth: {
      schemes: ['oauth2', 'bearer'],
      oauth_metadata: new URL('/.well-known/oauth-authorization-server', request.url).toString(),
      resource_metadata: new URL('/.well-known/oauth-protected-resource', request.url).toString(),
    },
    tool_count: ALL_MCP_TOOLS.length,
  }))
}

export async function POST(request: Request) {
  const auth = await authenticateMcpRequest(request.headers.get('authorization'))
  if (!auth) return unauthorizedResponse(request)

  // Stateless mode: one transport per request | no in-memory session state.
  // Returns JSON responses instead of SSE streams for simpler client compat
  // (both Claude and ChatGPT custom MCP connectors support this fine).
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  })

  const server = createXphereMcpServer(auth)
  await server.connect(transport)

  try {
    const response = await transport.handleRequest(request)
    return withCors(response)
  } finally {
    // Ensure transport resources are released | server.close() also closes it.
    void server.close().catch(() => undefined)
  }
}
