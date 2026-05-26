// DEPRECATED | superseded by the unified MCP endpoint at /api/mcp.
// All Projects actions are now MCP tools with the prefix `projects_*`
// (e.g. `projects_list_tasks`). See /settings/mcp for the new URL + auth.

export const runtime = 'nodejs'

const DEPRECATION_BODY = {
  error: 'gone',
  message:
    'This endpoint has moved. Use the unified MCP server at /api/mcp ' +
    '(JSON-RPC 2.0 over Streamable HTTP). Tools are now prefixed projects_*. ' +
    'Configure your MCP client with the new URL — Bearer xph_... tokens still work.',
  new_endpoint: '/api/mcp',
  oauth_metadata: '/.well-known/oauth-authorization-server',
}

function gone() {
  return Response.json(DEPRECATION_BODY, {
    status: 410,
    headers: { 'Deprecation': 'true', 'Sunset': '2026-12-31' },
  })
}

export async function POST() { return gone() }
export async function GET() { return gone() }
