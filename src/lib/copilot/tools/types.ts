// Tool shape shared across copilot domains.
// Each tool is an Anthropic.Tool definition + an async handler that gets the
// authenticated Supabase client (RLS-scoped) + the resolved input.

import type Anthropic from '@anthropic-ai/sdk'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

export interface ToolContext {
  supabase: SupabaseClient<Database>
  orgId: string
  userId: string
}

export interface ToolResult {
  success: boolean
  data?: unknown
  error?: string
}

export interface CopilotTool {
  definition: Anthropic.Tool
  handler: (input: Record<string, unknown>, ctx: ToolContext) => Promise<ToolResult>
  /**
   * 'read'  | query / get / list. Always available.
   * 'write' | mutate. Only enabled when writeMode = true.
   * 'destructive' | delete or bulk. Requires writeMode + confirm_token.
   */
  mode: 'read' | 'write' | 'destructive'
}

export type CopilotToolRegistry = Record<string, CopilotTool>
