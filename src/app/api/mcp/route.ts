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

// Coolify/Traefik passes the public hostname in X-Forwarded-Host (or Host).
// request.url resolves to the internal container address (0.0.0.0:3000),
// so we must read from headers to get the real public origin.
function getPublicOrigin(request: Request): string {
  const host = request.headers.get('x-forwarded-host') || request.headers.get('host')
  if (host) {
    const proto = host.startsWith('localhost') || host.startsWith('127.') ? 'http' : 'https'
    return `${proto}://${host}`
  }
  return 'https://xphere.app'
}

function unauthorizedResponse(request: Request): Response {
  // Per RFC 9728 / MCP spec: tell the client where to find resource metadata
  // so it can discover the authorization server and start the OAuth flow.
  const origin = getPublicOrigin(request)
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
  if (request.headers.get('authorization')) logMcpRequest(request, 200, null)
  // Discovery / health response. The real MCP traffic comes over POST.
  // Streamable HTTP allows GET for server-initiated SSE, but in stateless mode
  // we just expose metadata.
  return withCors(Response.json({
    name: 'xphere-mcp',
    version: '1.0.0',
    protocol: 'MCP Streamable HTTP',
    auth: {
      schemes: ['oauth2', 'bearer'],
      oauth_metadata: `${getPublicOrigin(request)}/.well-known/oauth-authorization-server`,
      resource_metadata: `${getPublicOrigin(request)}/.well-known/oauth-protected-resource`,
    },
    tool_count: ALL_MCP_TOOLS.length,
  }))
}

// Streamable HTTP requires clients to accept both JSON and SSE, and the SDK
// answers 406 otherwise. We only ever reply with JSON (enableJsonResponse),
// so a client or credential probe that sends `Accept: application/json`,
// `*/*` or nothing is rewritten instead of being turned away.
async function withMcpAccept(request: Request, body: string): Promise<Request> {
  const accept = request.headers.get('accept') ?? ''
  if (accept.includes('application/json') && accept.includes('text/event-stream')) {
    return new Request(request.url, { method: 'POST', headers: request.headers, body })
  }
  const headers = new Headers(request.headers)
  headers.set('accept', 'application/json, text/event-stream')
  return new Request(request.url, { method: 'POST', headers, body })
}

// One line per failed request (and per authenticated GET, which is what a
// credential probe tends to send) so a misbehaving client can be diagnosed
// from the container logs. Never logs the credential itself, only its shape.
function logMcpRequest(request: Request, status: number, rpcMethod: string | null) {
  const authHeader = request.headers.get('authorization') ?? ''
  const scheme = authHeader ? (authHeader.split(' ')[0] || 'raw') : 'none'
  const credential = authHeader.includes(' ') ? authHeader.slice(authHeader.indexOf(' ') + 1).trim() : authHeader
  console.warn(
    `[mcp] ${request.method} ${status} rpc=${rpcMethod ?? '-'} auth=${scheme} cred_len=${credential.length}` +
      ` cred_kind=${credential.startsWith('xph_') ? 'xph' : credential ? 'other' : 'none'}` +
      ` accept="${request.headers.get('accept') ?? ''}" ua="${request.headers.get('user-agent') ?? ''}"`,
  )
}

function rpcMethodOf(body: string): string | null {
  try {
    const parsed = JSON.parse(body)
    const first = Array.isArray(parsed) ? parsed[0] : parsed
    return typeof first?.method === 'string' ? first.method : null
  } catch {
    return null
  }
}

export async function POST(request: Request) {
  const body = await request.text()
  const auth = await authenticateMcpRequest(request.headers.get('authorization'))
  if (!auth) {
    logMcpRequest(request, 401, rpcMethodOf(body))
    return unauthorizedResponse(request)
  }

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
    const response = await transport.handleRequest(await withMcpAccept(request, body))
    if (response.status >= 400) logMcpRequest(request, response.status, rpcMethodOf(body))
    return withCors(response)
  } finally {
    // Ensure transport resources are released | server.close() also closes it.
    void server.close().catch(() => undefined)
  }
}
