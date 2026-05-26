// Shared types for MCP tool definitions in the Xphere server.
//
// Each tool receives a McpAuthContext (so the handler knows which org/user is
// calling) and returns either a JSON-serializable payload OR a structured
// error. Routing + audit logging happen in server.ts | tools focus on the
// domain logic.

import type { ZodTypeAny, z } from 'zod'
import type { McpAuthContext } from './auth'

export interface McpToolContext {
  auth: McpAuthContext
}

/**
 * Tools return either plain JSON (success) or this shape (handled failure).
 * Uncaught throws are converted to `{ error: 'internal', detail: '...' }` by
 * the server wrapper.
 */
export interface McpToolError {
  error: string                       // short stable code, e.g. 'not_found'
  detail?: string
  status?: number                     // optional HTTP-ish status for logs
}

export type McpToolResult<T> = T | McpToolError

export interface McpToolDef<S extends ZodTypeAny = ZodTypeAny, T = unknown> {
  name: string                        // 'projects_list_tasks' etc.
  title?: string                      // human-readable label for tools/list
  description: string
  inputSchema: S
  area: 'general_xphere' | 'projects' | 'oauth'
  handler: (input: z.output<S>, ctx: McpToolContext) => Promise<McpToolResult<T>>
}

export function isToolError(value: unknown): value is McpToolError {
  return (
    typeof value === 'object' &&
    value !== null &&
    'error' in value &&
    typeof (value as { error: unknown }).error === 'string'
  )
}
