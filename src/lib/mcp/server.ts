// Factory that builds an MCP server with all Xphere tools registered.
// Wires the SDK's McpServer to our tool registry and injects auth context
// + audit logging on every call.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { ToolAnnotations } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import type { McpAuthContext } from './auth'
import { writeMcpAuditLog } from './auth'
import { resolveEffectiveOrg } from './membership'
import { ALL_MCP_TOOLS } from './registry'
import { isToolError, type McpToolDef } from './tool-types'

/**
 * Infer ToolAnnotations from the tool name. Used by Claude / ChatGPT to group
 * tools in their permission UIs (read-only vs writes vs destructive).
 *
 * Convention:
 *   *_list, *_get, *_count, *_search        → read-only + idempotent
 *   *_delete, *_cancel                      → destructive + idempotent
 *   *_create, *_add_*, *_send_*, *_trigger  → write + NOT idempotent
 *   everything else (*_update, *_set, etc.) → write + idempotent
 *
 * All Xphere tools operate on the org's own DB (closed world) | openWorldHint=false.
 * A tool can override these defaults by setting `annotations` on its McpToolDef.
 */
function inferAnnotations(name: string): ToolAnnotations {
  const parts = name.split('_')
  const has = (token: string) => parts.includes(token)

  if (has('list') || has('get') || has('count') || has('search')) {
    return { readOnlyHint: true, idempotentHint: true, openWorldHint: false }
  }
  if (has('delete') || has('cancel')) {
    return { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false }
  }
  if (has('create') || has('add') || has('send') || has('trigger')) {
    return { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }
  }
  return { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }
}

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

// Unwraps a Zod schema down to its raw shape. Plain ZodObjects expose `.shape`
// directly | schemas built with `.refine()`/`.transform()` are wrapped in a
// ZodEffects that has no `.shape` of its own, so we recurse into its inner
// `_def.schema` until we reach the underlying object.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function unwrapShape(schema: any): Record<string, z.ZodTypeAny> {
  if (!schema) return {}
  if (schema.shape && typeof schema.shape === 'object') return schema.shape
  if (schema._def?.schema) return unwrapShape(schema._def.schema)
  return {}
}

function registerTool(server: McpServer, tool: McpToolDef, auth: McpAuthContext) {
  // SDK accepts a ZodRawShape for tool() input schema. For our defs we built
  // each schema as a ZodObject | extract its shape, or fall back to no input.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const schema: any = tool.inputSchema
  const shape: Record<string, z.ZodTypeAny> = unwrapShape(schema)

  const annotations: ToolAnnotations = {
    ...inferAnnotations(tool.name),
    ...(tool.annotations ?? {}),
    title: tool.annotations?.title ?? tool.title ?? tool.name,
  }

  // Extend every tool's registered schema with an optional org_id parameter.
  // The framework resolves + validates it before the tool handler runs.
  const extendedShape = { ...shape, org_id: z.string().uuid().optional() }

  server.registerTool(
    tool.name,
    {
      title: tool.title ?? tool.name,
      description: tool.description,
      inputSchema: extendedShape,
      annotations,
    },
    async (input: unknown) => {
      // --- Per-call org resolution -------------------------------------------
      // Extract org_id from input, then strip it so tool handlers stay unaware.
      const rawInput = input as Record<string, unknown>
      const requestedOrgId = rawInput.org_id as string | undefined
      delete rawInput.org_id

      const { effectiveAuth, denial } = await resolveEffectiveOrg(auth, requestedOrgId)

      if (denial) {
        void writeMcpAuditLog({
          orgId: auth.orgId,
          actor: auth.actor,
          area: tool.area,
          action: tool.name,
          status: 'blocked',
          notes: `org_id ${requestedOrgId} denied — user is not a member`,
        })
        return {
          content: [{ type: 'text', text: JSON.stringify(denial) }],
          isError: true,
        }
      }

      // --- Tool execution ----------------------------------------------------
      let payload: unknown
      let status: 'success' | 'failed' = 'success'
      let auditNotes: string | undefined

      try {
        const result = await tool.handler(rawInput, { auth: effectiveAuth })
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

      // Audit log records the per-call resolved org (effectiveAuth.orgId).
      void writeMcpAuditLog({
        orgId: effectiveAuth.orgId,
        actor: effectiveAuth.actor,
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
