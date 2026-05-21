// Tool dispatcher | runs the named tool with the auth-scoped Supabase client.

import { ALL_TOOLS } from './tools'
import type { ToolContext, ToolResult } from './tools/types'

export async function dispatchCopilotTool(
  name: string,
  input: Record<string, unknown>,
  ctx: ToolContext,
): Promise<{ result: ToolResult; durationMs: number }> {
  const start = Date.now()
  const tool = ALL_TOOLS[name]
  if (!tool) {
    return {
      result: { success: false, error: `unknown tool: ${name}` },
      durationMs: Date.now() - start,
    }
  }
  try {
    const result = await tool.handler(input, ctx)
    return { result, durationMs: Date.now() - start }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return {
      result: { success: false, error: msg },
      durationMs: Date.now() - start,
    }
  }
}
