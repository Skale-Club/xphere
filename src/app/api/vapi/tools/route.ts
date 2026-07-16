// src/app/api/vapi/tools/route.ts
// Node.js Route Handler | receives Vapi tool-call webhooks during live calls.
// Vercel Hobby-friendly: no Edge Runtime dependency, but still must respond fast.
// MUST always return HTTP 200.

import { VapiToolCallMessageSchema, getToolArguments } from '@/types/vapi'
import { resolveOrgForAssistant } from '@/lib/vapi/end-of-call'
import { resolveTool } from '@/lib/action-engine/resolve-tool'
import { executeAction } from '@/lib/action-engine/execute-action'
import { decrypt } from '@/lib/crypto'
import { verifyVapiSecret } from '@/lib/vapi/verify-signature'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import { createLogger } from '@/lib/obs/logger'

export const runtime = 'nodejs'

const obs = createLogger({ route: 'api/vapi/tools' })

export async function POST(request: Request): Promise<Response> {
  // Outer catch: prevents ANY uncaught error from returning non-200 to Vapi
  try {
    if (!verifyVapiSecret(request)) {
      obs.warn('vapi_secret_rejected')
      return Response.json({ results: [] }, { status: 200 })
    }

    // 1. Parse + validate Vapi payload
    let body: unknown
    try {
      body = await request.json()
    } catch {
      // Malformed JSON | Vapi may retry; return empty results (not an error from Vapi's perspective)
      return Response.json({ results: [] }, { status: 200 })
    }

    const parsed = VapiToolCallMessageSchema.safeParse(body)
    if (!parsed.success) {
      return Response.json({ results: [] }, { status: 200 })
    }

    const { call, toolCallList } = parsed.data.message
    const toolCall = toolCallList[0]
    if (!toolCall) {
      return Response.json({ results: [] }, { status: 200 })
    }

    // 2. Create service-role Supabase client (bypasses RLS | no user JWT in Vapi requests)
    const supabase = createServiceRoleClient()

    // 3. Resolve org from assistant ID | assistant_mappings first (globally unique),
    // falling back to twilio_phone_numbers (ordered for determinism) — same
    // resolution used by the end-of-call webhooks so a call and its tool-calls
    // never disagree on which org owns them.
    const orgId = await resolveOrgForAssistant(call.assistantId, supabase)
    if (!orgId) {
      return Response.json({
        results: [{ toolCallId: toolCall.id, result: 'Service unavailable.' }]
      }, { status: 200 })
    }

    // 4. Resolve tool config (with nested integration credentials)
    const toolConfig = await resolveTool(orgId, toolCall.name, supabase)
    if (!toolConfig) {
      return Response.json({
        results: [{ toolCallId: toolCall.id, result: 'Tool not configured.' }]
      }, { status: 200 })
    }

    // 5. Decrypt API key + build credentials
    let result: string

    try {
      const apiKey = await decrypt(toolConfig.integrations.encrypted_api_key)
      const credentials = {
        apiKey,
        locationId: toolConfig.integrations.location_id ?? '',
      }
      const args = getToolArguments(toolCall)
      result = await executeAction(toolConfig.action_type, args, credentials, {
        organizationId: orgId,
        supabase,
        toolConfig: toolConfig.config,
        integrationProvider: toolConfig.integrations.provider,
      })
    } catch {
      // GHL executor threw (error, timeout, or unsupported action type)
      result = toolConfig.fallback_message
    }

    // 6. Per-call action history: NOT written here anymore. SEED-025 Phase F
    // turned action_logs into a read-only historical table — logAction()
    // (src/lib/action-engine/log-action.ts) is a no-op stub, so the
    // organization_id/tool_config_id/execution_ms/etc. payload this route used
    // to assemble was being thrown away on every tool call. There is also no
    // replacement run-log: workflow_runs only records kind='flow' DAG
    // executions (trigger_type/trigger_payload); resolveWorkflowAsTool
    // (src/lib/workflows/resolve.ts), which is what resolveTool() above
    // delegates to for kind='tool' workflows, calls executeAction() directly
    // with no run row created in between. Net effect: live AI-call action
    // timelines are not currently reconstructable from any DB table — only
    // action_logs rows written before the Phase F cutover still exist, and
    // call-detail-ai.tsx reads those as read-only legacy history.

    // 7. Return to Vapi | always HTTP 200
    return Response.json({
      results: [{ toolCallId: toolCall.id, result }]
    }, { status: 200 })

  } catch (outerErr) {
    // Truly unexpected error | still return 200 so Vapi doesn't go silent
    obs.error('vapi_tools_unexpected_error', { error: outerErr })
    return Response.json({
      results: [{ toolCallId: 'unknown', result: 'Service unavailable.' }]
    }, { status: 200 })
  }
}
