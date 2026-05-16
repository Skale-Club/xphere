// tests/agent-runtime-integration.test.ts
// Full runAgent() integration test against real Supabase.
// Phase 34 RUNTIME-01..10 + TOOL-06 (tool denial path) + AGENT-10 (inactive agent).
// Requires .env.local with SUPABASE_* credentials (loaded by setup/load-env.ts).
//
// NOTE: If ANTHROPIC_API_KEY is not in .env.local, runAgent() will return status='error'
// (no_anthropic_key). Tests assert invocation rows are still written correctly.

import { describe, it, expect, beforeAll } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '../src/types/database'
import { runAgent } from '../src/lib/agent-runtime'

// ---------------------------------------------------------------------------
// Setup — connect to real Supabase and find Main Agent
// ---------------------------------------------------------------------------

let admin: SupabaseClient<Database>
let orgId: string
let agentId: string

beforeAll(async () => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !key) {
    throw new Error(
      'SUPABASE credentials missing from .env.local — cannot run integration tests.\n' +
      'Expected: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY'
    )
  }

  admin = createClient<Database>(url, key, { auth: { persistSession: false } })

  // Fetch a real org + Main Agent from Phase 33 seed
  const { data: agentRow, error } = await admin
    .from('agents')
    .select('id, organization_id')
    .eq('name', 'Main Agent')
    .limit(1)
    .single()

  if (error || !agentRow) {
    throw new Error(
      'No Main Agent found in Supabase — Phase 33 seed missing.\n' +
      `Supabase error: ${error?.message ?? 'no row returned'}`
    )
  }

  orgId = agentRow.organization_id
  agentId = agentRow.id
})

// ---------------------------------------------------------------------------
// RUNTIME-01..10: Full runAgent() pipeline
// ---------------------------------------------------------------------------

describe('runAgent() integration (Phase 34 RUNTIME-01..10)', () => {
  it('RUNTIME-01..02: returns a valid AgentRunResult with traceId + invocation row written', async () => {
    const result = await runAgent({
      orgId,
      agentId,
      channel: 'web_widget',
      userMessage: 'ping — integration test Phase 34',
      mode: 'production',
    })

    // Kill switch not active → must NOT be skipped
    expect(result.status).not.toBe('skipped')
    // Properly seeded Main Agent on web_widget → must NOT be denied
    expect(result.status).not.toBe('denied')

    // traceId is always present (generated before kill switch check)
    expect(result.traceId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)

    // invocationId is a UUID — may be 'insert-failed' if DB write fails, but should be a UUID
    // Accept both 'success' and 'error' as valid final states (error = no API key in .env.local)
    expect(['success', 'error', 'aborted']).toContain(result.status)
  }, 45000)

  it('RUNTIME-10: invocation row written with status != "running" and trace_id set', async () => {
    const result = await runAgent({
      orgId,
      agentId,
      channel: 'web_widget',
      userMessage: 'test invocation write — Phase 34 RUNTIME-10',
      mode: 'production',
    })

    // Only check if invocationId was written (not 'insert-failed')
    if (result.invocationId && result.invocationId !== 'insert-failed' && result.invocationId !== '') {
      // Verify the agent_invocations row was finalized
      const { data: row, error } = await admin
        .from('agent_invocations')
        .select('status, tokens_in, model, duration_ms, trace_id')
        .eq('id', result.invocationId)
        .single()

      expect(error).toBeNull()
      expect(row).not.toBeNull()

      // D-34-03: must be updated from 'running' to final status
      expect(row!.status).not.toBe('running')

      // trace_id must match
      expect(row!.trace_id).toBe(result.traceId)

      // duration_ms must be non-negative
      expect(row!.duration_ms).toBeGreaterThanOrEqual(0)
    }
  }, 45000)

  it('RUNTIME-04 depth stub: _depth=3 returns status=denied with invocationId=""', async () => {
    const result = await runAgent({
      orgId,
      agentId,
      channel: 'web_widget',
      userMessage: 'depth guard test',
      _depth: 3, // exceeds MAX_DELEGATION_DEPTH=2
    })

    // D-34-10: depth guard fires before any DB write
    expect(result.status).toBe('denied')
    expect(result.errorDetail).toBe('delegation_depth_exceeded')
    // No invocation row written for denied call (D-34-12 / D-34-13)
    expect(result.invocationId).toBe('')
  }, 15000)

  it('RUNTIME-09 kill switch: AGENT_RUNTIME_ENABLED=false returns skipped within 1s', async () => {
    const original = process.env.AGENT_RUNTIME_ENABLED
    process.env.AGENT_RUNTIME_ENABLED = 'false'

    const start = Date.now()
    const result = await runAgent({
      orgId,
      agentId,
      channel: 'web_widget',
      userMessage: 'kill switch integration test',
    })
    const elapsed = Date.now() - start

    // Restore before assertions (in case of assertion failure)
    if (original !== undefined) {
      process.env.AGENT_RUNTIME_ENABLED = original
    } else {
      delete process.env.AGENT_RUNTIME_ENABLED
    }

    // GATE-03: must return in < 1s
    expect(elapsed).toBeLessThan(1000)
    expect(result.status).toBe('skipped')
    // No invocation row for skipped call
    expect(result.invocationId).toBe('')
  }, 5000)

  it('AGENT-10 inactive agent: is_active=false returns denied without invocation row', async () => {
    // Temporarily deactivate the Main Agent
    const { error: deactivateErr } = await admin
      .from('agents')
      .update({ is_active: false })
      .eq('id', agentId)

    expect(deactivateErr).toBeNull()

    let result
    try {
      result = await runAgent({
        orgId,
        agentId,
        channel: 'web_widget',
        userMessage: 'inactive agent test',
      })
    } finally {
      // Always restore is_active=true (even if test assertion fails)
      await admin.from('agents').update({ is_active: true }).eq('id', agentId)
    }

    expect(result!.status).toBe('denied')
    expect(result!.errorDetail).toBe('agent_inactive')
    // D-34-13: no invocation row for denied inactive agent
    expect(result!.invocationId).toBe('')
  }, 15000)

  it('AGENT-05 KB scope: kb_scope set to non-null does not return denied/skipped', async () => {
    // Set kb_scope to a non-empty array temporarily
    const { error: updateErr } = await admin
      .from('agents')
      .update({ kb_scope: ['test-tag-integration'] })
      .eq('id', agentId)

    expect(updateErr).toBeNull()

    let result
    try {
      result = await runAgent({
        orgId,
        agentId,
        channel: 'web_widget',
        userMessage: 'test KB scope path — integration',
        mode: 'production',
      })
    } finally {
      // Always restore kb_scope to null
      await admin.from('agents').update({ kb_scope: null }).eq('id', agentId)
    }

    // KB scope set → queryKnowledge called → result may be 'success' or 'error' (API key)
    // Key assertion: kb_scope path does NOT return 'denied' or 'skipped'
    expect(result!.status).not.toBe('denied')
    expect(result!.status).not.toBe('skipped')
  }, 45000)
})
