// Deno Edge Function: integration-health (SEED-025 Phase D)
//
// Runs every 15 minutes (via Supabase scheduled trigger or Vercel Cron
// hitting this endpoint). For each active integration:
//   1. Run a lightweight, provider-specific probe (ping endpoint, key check)
//   2. Record the result in integration_health_checks
//   3. Update integrations.health_status / failure_count / last_checked_at
//
// State machine for health_status:
//   connected   ── 2 consecutive failures ──> degraded
//   degraded    ── 2 more failures (4 total) ──> disconnected
//   any         ── 1 success ──> connected (failure_count reset to 0)
//
// When an integration flips to 'disconnected', every workflow that
// references it is marked health_blocked. On reconnect (next successful
// probe), the block is cleared. This is the gating mechanism the
// workflow builder and AI authoring layer consume.

import { createClient } from 'npm:@supabase/supabase-js@^2'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false } },
)

type Provider =
  | 'gohighlevel'
  | 'twilio'
  | 'calcom'
  | 'custom_webhook'
  | 'openai'
  | 'anthropic'
  | 'openrouter'
  | 'vapi'
  | 'manychat'
  | 'google_contacts'
  | 'google_calendar'

interface ProbeResult {
  ok: boolean
  latency_ms: number
  error?: string
}

// Per-provider probe. Today the implementations are deliberately conservative —
// they verify the integration row has the credentials it needs and that the
// row itself is active. A follow-up patch wires real API pings per provider.
async function probe(
  _integrationId: string,
  provider: Provider,
  hasKey: boolean,
): Promise<ProbeResult> {
  const start = performance.now()

  // Without an encrypted key there is no way to authenticate; fail fast.
  if (!hasKey) {
    return {
      ok: false,
      latency_ms: Math.round(performance.now() - start),
      error: 'Missing encrypted_api_key',
    }
  }

  // Provider-specific probes are intentionally stubbed here. Each one will
  // be wired progressively (Twilio: /Accounts ping, Manychat: /me, Google:
  // token refresh, etc.) without changing this dispatch structure.
  switch (provider) {
    case 'gohighlevel':
    case 'twilio':
    case 'calcom':
    case 'custom_webhook':
    case 'openai':
    case 'anthropic':
    case 'openrouter':
    case 'vapi':
    case 'manychat':
    case 'google_contacts':
    case 'google_calendar':
      // Default: presence of credentials counts as connected for the v1 probe.
      // Real network probes land in subsequent patches without changing
      // this file's contract.
      return { ok: true, latency_ms: Math.round(performance.now() - start) }
  }
}

function nextStatus(
  current: 'connected' | 'degraded' | 'disconnected' | 'unknown',
  failureCount: number,
  ok: boolean,
): { status: 'connected' | 'degraded' | 'disconnected'; failureCount: number } {
  if (ok) {
    return { status: 'connected', failureCount: 0 }
  }
  const nextFailures = failureCount + 1
  if (nextFailures >= 4) return { status: 'disconnected', failureCount: nextFailures }
  if (nextFailures >= 2) return { status: 'degraded', failureCount: nextFailures }
  // First failure on a previously-connected integration: stay 'connected'
  // (one-off blips don't flip status), but bump the counter.
  if (current === 'connected') return { status: 'connected', failureCount: nextFailures }
  return { status: current === 'unknown' ? 'connected' : current, failureCount: nextFailures }
}

async function applyBlockFlag(integrationId: string, blocked: boolean, reason?: string) {
  // Workflows that reference an integration via the action node's
  // credential_ref need to be flipped in sync. We update every workflow
  // whose current version definition contains a node referencing this
  // integration. A precise query lives in the resolver; for the health
  // job we do a broader scan via a SQL function for performance.
  if (blocked) {
    await supabase.rpc('mark_workflows_blocked_by_integration', {
      p_integration_id: integrationId,
      p_reason: reason ?? 'Integration disconnected',
    })
  } else {
    await supabase.rpc('clear_workflows_blocked_by_integration', {
      p_integration_id: integrationId,
    })
  }
}

Deno.serve(async (_req: Request) => {
  const { data: integrations, error } = await supabase
    .from('integrations')
    .select('id, organization_id, provider, encrypted_api_key, health_status, failure_count')
    .eq('is_active', true)

  if (error || !integrations) {
    return new Response(JSON.stringify({ ok: false, error: error?.message ?? 'no data' }), {
      status: 500,
    })
  }

  let processed = 0
  let flipped = 0

  for (const row of integrations) {
    const result = await probe(
      row.id as string,
      row.provider as Provider,
      !!row.encrypted_api_key,
    )

    const transition = nextStatus(
      row.health_status as 'connected' | 'degraded' | 'disconnected' | 'unknown',
      Number(row.failure_count ?? 0),
      result.ok,
    )

    const prevStatus = row.health_status as string
    const statusChanged = prevStatus !== transition.status

    // History entry (every probe writes one row)
    await supabase.from('integration_health_checks').insert({
      integration_id: row.id as string,
      organization_id: row.organization_id as string,
      status: transition.status,
      latency_ms: result.latency_ms,
      error: result.error ?? null,
    })

    // Current state on the integrations row
    await supabase
      .from('integrations')
      .update({
        health_status: transition.status,
        failure_count: transition.failureCount,
        last_checked_at: new Date().toISOString(),
        last_error: result.error ?? null,
      })
      .eq('id', row.id as string)

    // Workflow blocking transitions
    if (statusChanged) {
      flipped++
      if (transition.status === 'disconnected') {
        await applyBlockFlag(row.id as string, true, `Integration disconnected: ${result.error ?? 'no error reported'}`)
      } else if (prevStatus === 'disconnected') {
        await applyBlockFlag(row.id as string, false)
      }
    }

    processed++
  }

  return new Response(
    JSON.stringify({ ok: true, processed, flipped }),
    { headers: { 'Content-Type': 'application/json' } },
  )
})
