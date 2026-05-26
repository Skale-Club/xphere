// Factory that builds an MCP server with all Xphere tools registered.
// Wires the SDK's McpServer to our tool registry and injects auth context
// + audit logging on every call.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import type { McpAuthContext } from './auth'
import { writeMcpAuditLog } from './auth'
import { ALL_MCP_TOOLS } from './registry'
import { isToolError, type McpToolDef } from './tool-types'

const SERVER_NAME = 'xphere-mcp'
const SERVER_VERSION = '1.0.0'

export function createXphereMcpServer(auth: McpAuthContext): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { capabilities: { tools: {} } },
  )

  for (const tool of ALL_MCP_TOOLS) {
    registerTool(server, tool, auth)
  }

  return server
}

function registerTool(server: McpServer, tool: McpToolDef, auth: McpAuthContext) {
  // SDK accepts a ZodRawShape for tool() input schema. For our defs we built
  // each schema as a ZodObject | extract its shape, or fall back to no input.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const schema: any = tool.inputSchema
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const shape: Record<string, z.ZodTypeAny> = (schema && typeof schema.shape === 'object')
    ? schema.shape
    : {}

  server.tool(
    tool.name,
    tool.description,
    shape,
    async (input: unknown) => {
      let payload: unknown
      let status: 'success' | 'failed' = 'success'
      let auditNotes: string | undefined

      try {
        const result = await tool.handler(input, { auth })
        if (isToolError(result)) {
          status = 'failed'
          auditNotes = result.detail ?? result.error
          payload = result
        } else {
          payload = result
        }
      } catch (e) {
        status = 'failed'
        auditNotes = e instanceof Error ? e.message : String(e)
        payload = { error: 'internal', detail: auditNotes }
      }

      // Audit log | best-effort, never blocks the response.
      void writeMcpAuditLog({
        orgId: auth.orgId,
        actor: auth.actor,
        area: tool.area,
        action: tool.name,
        status,
        notes: auditNotes,
      })

      return {
        content: [
          { type: 'text', text: JSON.stringify(payload) },
        ],
        // Convey machine-readable failure to clients that honor isError.
        isError: status === 'failed',
      }
    },
  )
}
