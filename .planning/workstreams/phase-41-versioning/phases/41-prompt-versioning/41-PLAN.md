---
phase: 41
name: Prompt Versioning UX
milestone: v2.0 Multi-Bot Platform
requirements: [AGENT-11, AGENT-12, AGENT-13, AGENT-14, AGENT-15]
status: planned
created: 2026-05-17
waves: 4
---

# Phase 41: Prompt Versioning UX — PLAN

## Phase Goal

Every change to an agent's system prompt automatically creates an immutable version row via DB trigger; the runtime reads the prompt from `active_prompt_version_id`, never directly from `agents.system_prompt`; admins edit drafts and explicitly Publish to promote; rollback is one click and never mutates a version row.

## Architecture Overview

**What's already in place (from Phases 33–36):**
- `agent_prompt_versions` table exists (migration 035) with `(id, organization_id, agent_id, version, system_prompt, created_by, created_at)` and a `UNIQUE(agent_id, version)` constraint
- `agents.active_prompt_version_id` FK column exists pointing to `agent_prompt_versions.id`
- `resolve-agent.ts` already reads prompts from the version row via the FK join — it falls back to `agents.system_prompt` with a console.warn when no version exists
- Phase 33 seeded version=1 for the Main Agent backfill
- DB trigger for auto-snapshot was **explicitly deferred to Phase 41** (D-33-16 in migration comment)

**What Phase 41 delivers:**
1. DB trigger: `INSERT INTO agent_prompt_versions` whenever `agents.system_prompt` is updated (AGENT-11)
2. Runtime hardening: `resolve-agent.ts` promoted from "fallback to system_prompt" to error on missing version; no direct reads of `agents.system_prompt` (AGENT-12)
3. Draft/Publish flow: saving prompt edit creates a draft version row; "Publish" promotes `active_prompt_version_id` (AGENT-15)
4. Prompt History UI at `/dashboard/agents/[id]/prompt-history` with unified diff view (AGENT-13)
5. One-click Activate/rollback via server action (AGENT-14)

## Success Criteria (from ROADMAP)

1. Updating `agents.system_prompt` automatically inserts a row in `agent_prompt_versions(agent_id, version, system_prompt, created_by, created_at)` via DB trigger; version number monotonically increases per agent
2. `runAgent()` always loads the prompt from the row pointed to by `agents.active_prompt_version_id`, never from `agents.system_prompt` directly (verified by integration test that mutates `system_prompt` and asserts runtime still uses the old active version)
3. Saving a prompt edit creates a draft version (new row, but `active_prompt_version_id` unchanged); promoting to production requires an explicit "Publish" action (no auto-promote on save)
4. Admin can view the prompt version history list at `/dashboard/agents/[id]` with author, timestamp, and unified diff against the previous version
5. Clicking "Activate" on any prior version updates `active_prompt_version_id` and creates a new audit log entry; the version row itself is never mutated; rollback completes in a single click

---

## Wave Structure

| Wave | Plans | What it builds | Parallel? |
|------|-------|----------------|-----------|
| 0 | 41-01 | DB trigger + migration 045 + types regen + test stubs | Sequential (foundation) |
| 1 | 41-02, 41-03 | Runtime hardening + server actions | Parallel |
| 2 | 41-04 | Prompt History UI (diff viewer + Activate button) | Sequential (after Wave 1) |
| 3 | 41-05 | Integration test suite + build gate | Sequential (after Wave 2) |

---

## Plan 41-01: Migration 045 — DB Trigger + Test Stubs (Wave 0)

```yaml
wave: 0
depends_on: []
files_modified:
  - supabase/migrations/045_agent_prompt_version_trigger.sql
  - src/types/database.ts
  - tests/agent-prompt-versioning.test.ts
autonomous: true
requirements: [AGENT-11, AGENT-12]
```

### Objective

Add the DB trigger that auto-snapshots `agents.system_prompt` into `agent_prompt_versions` on every UPDATE, push migration to remote, regenerate types, and write RED test stubs for AGENT-11 and AGENT-12.

### Tasks

#### Task 41-01-T01: Write Migration 045

<read_first>
- `supabase/migrations/035_agent_prompt_versions.sql` — existing table schema and constraints
- `supabase/migrations/044_agents_generation_config.sql` — most recent migration pattern
- `src/types/database.ts` lines 380-460 — agents and agent_prompt_versions Row types
</read_first>

<action>
Create `supabase/migrations/045_agent_prompt_version_trigger.sql` with:

```sql
-- =============================================================================
-- Migration: 045_agent_prompt_version_trigger
-- Phase: 41 — Prompt Versioning UX
-- Creates: DB trigger to auto-snapshot agents.system_prompt on UPDATE
-- Decision: D-33-16 (deferred from Phase 33 — lands here as planned)
-- =============================================================================

-- Helper function: compute next version number per agent
CREATE OR REPLACE FUNCTION public.next_agent_prompt_version(p_agent_id UUID)
  RETURNS INTEGER
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = public
AS $$
  SELECT COALESCE(MAX(version), 0) + 1
  FROM public.agent_prompt_versions
  WHERE agent_id = p_agent_id;
$$;

-- Trigger function: insert version row when system_prompt changes
CREATE OR REPLACE FUNCTION public.trg_agent_prompt_version_snapshot()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
DECLARE
  v_version INTEGER;
BEGIN
  -- Only fire when system_prompt actually changed
  IF NEW.system_prompt IS NOT DISTINCT FROM OLD.system_prompt THEN
    RETURN NEW;
  END IF;

  -- Compute next version atomically (UNIQUE constraint on (agent_id, version) is the safety net)
  v_version := public.next_agent_prompt_version(NEW.id);

  INSERT INTO public.agent_prompt_versions (
    organization_id,
    agent_id,
    version,
    system_prompt,
    created_by,
    created_at
  ) VALUES (
    NEW.organization_id,
    NEW.id,
    v_version,
    NEW.system_prompt,
    NEW.updated_by,   -- set by server action before UPDATE
    now()
  );

  RETURN NEW;
END;
$$;

-- Drop if exists to allow idempotent re-run
DROP TRIGGER IF EXISTS trg_agent_prompt_version_snapshot ON public.agents;

CREATE TRIGGER trg_agent_prompt_version_snapshot
  AFTER UPDATE OF system_prompt ON public.agents
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_agent_prompt_version_snapshot();

COMMENT ON TRIGGER trg_agent_prompt_version_snapshot ON public.agents IS
  'Phase 41: auto-snapshot system_prompt into agent_prompt_versions on every UPDATE (D-33-16).';
```

Note: `agents.updated_by` must be set by the server action immediately before the UPDATE so the trigger captures the correct user. Verify `agents` table has `updated_by UUID REFERENCES auth.users(id)` (it does — from migration 034).
</action>

<acceptance_criteria>
- `supabase/migrations/045_agent_prompt_version_trigger.sql` exists and contains `CREATE TRIGGER trg_agent_prompt_version_snapshot`
- File contains `CREATE OR REPLACE FUNCTION public.trg_agent_prompt_version_snapshot()`
- File contains `IF NEW.system_prompt IS NOT DISTINCT FROM OLD.system_prompt THEN RETURN NEW; END IF;`
- File contains `public.next_agent_prompt_version(NEW.id)`
- Migration filename is exactly `045_agent_prompt_version_trigger.sql`
</acceptance_criteria>

#### Task 41-01-T02: Push Migration + Regen Types

<read_first>
- `src/types/database.ts` lines 540-590 — existing agent_prompt_versions type block
</read_first>

<action>
1. Run `npx supabase db push` to apply migration 045 to the remote DB
2. Run `npx supabase gen types typescript --linked > src/types/database.ts` to regenerate types
3. Verify that `src/types/database.ts` still contains the `agent_prompt_versions` table type with all existing columns (`id`, `organization_id`, `agent_id`, `version`, `system_prompt`, `created_by`, `created_at`)
4. Run `npm run build` to confirm no TypeScript errors introduced by the migration
</action>

<acceptance_criteria>
- `npx supabase db push` exits 0
- `src/types/database.ts` contains `agent_prompt_versions` with all 7 columns
- `npm run build` exits 0 after types regen
- `src/types/database.ts` does NOT contain the `Functions` entry for `next_agent_prompt_version` as a user-callable RPC (it's SECURITY DEFINER — only used by the trigger)
</acceptance_criteria>

#### Task 41-01-T03: Write RED Test Stubs

<read_first>
- `tests/agent-prompt-versioning.test.ts` — create new file (does not exist yet)
- `tests/run-agent.test.ts` — existing test pattern for agent runtime mocking
- `src/lib/agent-runtime/resolve-agent.ts` — current resolve-agent implementation
</read_first>

<action>
Create `tests/agent-prompt-versioning.test.ts` with the following test stubs (all marked `todo` so they are RED without implementations):

```typescript
// tests/agent-prompt-versioning.test.ts
// Phase 41 integration tests for prompt versioning (AGENT-11, AGENT-12, AGENT-13, AGENT-14, AGENT-15)
// Wave 0: stubs only — RED until implementation lands in Plans 41-02 through 41-04

import { describe, it, expect, vi, beforeEach } from 'vitest'

describe('AGENT-11: DB trigger auto-snapshots system_prompt on UPDATE', () => {
  it.todo('updating agents.system_prompt creates a new agent_prompt_versions row')
  it.todo('version number increments monotonically per agent')
  it.todo('updating agents.system_prompt to the same value does NOT create a new version row')
  it.todo('created_by is set from agents.updated_by at time of UPDATE')
})

describe('AGENT-12: runtime always uses active_prompt_version_id, never agents.system_prompt directly', () => {
  it.todo('resolve-agent reads system_prompt from agent_prompt_versions row via active_prompt_version_id')
  it.todo('mutating agents.system_prompt after active version is set does not change resolved prompt')
  it.todo('resolve-agent returns null when active_prompt_version_id is null and no fallback allowed')
})

describe('AGENT-15: draft/publish flow', () => {
  it.todo('savePromptDraft creates a new agent_prompt_versions row but does not change active_prompt_version_id')
  it.todo('publishPromptVersion updates active_prompt_version_id to the specified version id')
  it.todo('saving a draft twice creates two separate version rows')
})

describe('AGENT-14: rollback (Activate)', () => {
  it.todo('activatePromptVersion updates active_prompt_version_id without mutating version rows')
  it.todo('activating a prior version is idempotent — calling twice gives same result')
})

describe('AGENT-13: version history list', () => {
  it.todo('getPromptVersionHistory returns versions ordered by version DESC')
  it.todo('each version item includes version number, created_by user email, created_at, and is_active flag')
})
```
</action>

<acceptance_criteria>
- `tests/agent-prompt-versioning.test.ts` exists
- File contains `describe('AGENT-11:` and `describe('AGENT-12:` and `describe('AGENT-15:` blocks
- Running `npx vitest run tests/agent-prompt-versioning.test.ts` shows all tests as `todo` (not failing, not passing)
- File imports `describe, it, expect, vi, beforeEach` from `'vitest'`
</acceptance_criteria>

### must_haves
- [ ] Migration 045 file exists and is syntactically valid SQL
- [ ] `npx supabase db push` applies migration without error
- [ ] TypeScript build passes after types regen
- [ ] Test stubs file exists with correct describe blocks for all 5 AGENT requirements

---

## Plan 41-02: Runtime Hardening — No Direct system_prompt Reads (Wave 1)

```yaml
wave: 1
depends_on: [41-01]
files_modified:
  - src/lib/agent-runtime/resolve-agent.ts
  - src/lib/agent-runtime/types.ts
autonomous: true
requirements: [AGENT-12]
```

### Objective

Remove the `agents.system_prompt` fallback from `resolve-agent.ts`. After Phase 41, every agent must have `active_prompt_version_id` set. If it's null, `resolveAgent` returns null and logs an error — it never falls back to reading `agents.system_prompt` directly.

### Tasks

#### Task 41-02-T01: Harden resolve-agent.ts

<read_first>
- `src/lib/agent-runtime/resolve-agent.ts` — full file (101 lines) — current implementation with fallback
- `src/lib/agent-runtime/types.ts` — ResolvedAgent type definition
- `src/types/database.ts` lines 380-460 — agents Row type confirming `active_prompt_version_id: string | null`
</read_first>

<action>
Modify `src/lib/agent-runtime/resolve-agent.ts`:

1. Remove the fallback branch that reads `agents.system_prompt` when `active_prompt_version_id` is null:

Current code (lines 43-59):
```typescript
const promptVersionRow = Array.isArray(agent.agent_prompt_versions)
  ? agent.agent_prompt_versions[0]
  : agent.agent_prompt_versions

let baseSystemPrompt: string
if (promptVersionRow?.system_prompt) {
  baseSystemPrompt = promptVersionRow.system_prompt
} else {
  console.warn(
    JSON.stringify({
      event: 'agent_prompt_version_missing',
      agentId,
      orgId,
      fallback: 'agents.system_prompt',
    })
  )
  baseSystemPrompt = agent.system_prompt ?? ''
}
```

Replace with:
```typescript
const promptVersionRow = Array.isArray(agent.agent_prompt_versions)
  ? agent.agent_prompt_versions[0]
  : agent.agent_prompt_versions

// Phase 41 (AGENT-12): runtime MUST use active_prompt_version_id; never reads agents.system_prompt directly.
// If active_prompt_version_id is null, resolveAgent returns null — caller falls back to fallback_message.
if (!promptVersionRow?.system_prompt) {
  console.error(
    JSON.stringify({
      event: 'agent_prompt_version_missing',
      agentId,
      orgId,
      active_prompt_version_id: agent.active_prompt_version_id,
      resolution: 'returning_null_to_caller',
    })
  )
  return null
}
const baseSystemPrompt = promptVersionRow.system_prompt
```

2. Remove `system_prompt` from the `.select()` query since it's no longer used as fallback. The select becomes:
```typescript
.select(`
  id,
  name,
  model,
  max_history,
  fallback_message,
  allowed_channels,
  channel_overrides,
  is_active,
  active_prompt_version_id,
  kb_scope,
  agent_prompt_versions!agents_active_prompt_version_id_fkey (
    id,
    system_prompt
  )
`)
```
</action>

<acceptance_criteria>
- `src/lib/agent-runtime/resolve-agent.ts` does NOT contain `agent.system_prompt` as a fallback value (grep `fallback.*agents.system_prompt` → 0 matches)
- `src/lib/agent-runtime/resolve-agent.ts` contains `return null` inside the `if (!promptVersionRow?.system_prompt)` block
- `src/lib/agent-runtime/resolve-agent.ts` does NOT have `system_prompt` in the `.select()` query (grep `'system_prompt'` in the select block → 0 in the outer agent select, only appears in the nested `agent_prompt_versions` select)
- `npm run build` exits 0
</acceptance_criteria>

### must_haves
- [ ] No direct `agents.system_prompt` reads remain in resolve-agent.ts
- [ ] `resolveAgent()` returns null (not a degraded fallback) when active_prompt_version_id is null
- [ ] Build passes

---

## Plan 41-03: Server Actions — Draft, Publish, Activate (Wave 1)

```yaml
wave: 1
depends_on: [41-01]
files_modified:
  - src/app/(dashboard)/agents/actions.ts
  - src/lib/agents/zod-schemas.ts
autonomous: true
requirements: [AGENT-11, AGENT-13, AGENT-14, AGENT-15]
```

### Objective

Add server actions for the draft/publish/activate flow and the version history query. These run in parallel with Plan 41-02 (different files, no runtime dependencies between them).

### Tasks

#### Task 41-03-T01: Add Prompt Version Server Actions

<read_first>
- `src/app/(dashboard)/agents/actions.ts` full file — existing CRUD actions pattern (getUser, createClient, RLS)
- `src/types/database.ts` lines 546-590 — agent_prompt_versions Row type
- `src/lib/agents/zod-schemas.ts` — existing AgentFormInput/Output shapes
</read_first>

<action>
Add the following server actions to `src/app/(dashboard)/agents/actions.ts`:

```typescript
// ─── Prompt Version Types ─────────────────────────────────────────────────────

export interface PromptVersionListItem {
  id: string
  version: number
  system_prompt: string
  created_at: string
  created_by: string | null
  created_by_email: string | null   // joined from auth.users via service-role client
  is_active: boolean                // true when this is the agent's active_prompt_version_id
}

// ─── getPromptVersionHistory ──────────────────────────────────────────────────

/**
 * Returns all prompt versions for an agent, ordered by version DESC.
 * Includes is_active flag derived from agents.active_prompt_version_id.
 * Uses service-role client to join user email from auth.users.
 * RLS: the agent row must be accessible to the caller (org-scoped).
 */
export async function getPromptVersionHistory(
  agentId: string
): Promise<PromptVersionListItem[]> {
  const user = await getUser()
  if (!user) return []

  // Use createClient for RLS-gated agent fetch (confirm caller can see the agent)
  const supabase = await createClient()
  const { data: agent } = await supabase
    .from('agents')
    .select('id, active_prompt_version_id')
    .eq('id', agentId)
    .single()
  if (!agent) return []

  // Use service-role to fetch versions + join user emails
  const { createServiceRoleClient } = await import('@/lib/supabase/admin')
  const adminClient = createServiceRoleClient()

  const { data: versions } = await adminClient
    .from('agent_prompt_versions')
    .select('id, version, system_prompt, created_at, created_by')
    .eq('agent_id', agentId)
    .order('version', { ascending: false })

  if (!versions) return []

  // Collect unique created_by UUIDs for email lookup
  const userIds = [...new Set(versions.map((v) => v.created_by).filter(Boolean) as string[])]
  const userEmailMap: Record<string, string> = {}
  if (userIds.length > 0) {
    const { data: { users } } = await adminClient.auth.admin.listUsers()
    for (const u of users ?? []) {
      if (userIds.includes(u.id)) {
        userEmailMap[u.id] = u.email ?? u.id
      }
    }
  }

  return versions.map((v) => ({
    id: v.id,
    version: v.version,
    system_prompt: v.system_prompt,
    created_at: v.created_at,
    created_by: v.created_by,
    created_by_email: v.created_by ? (userEmailMap[v.created_by] ?? v.created_by) : null,
    is_active: v.id === agent.active_prompt_version_id,
  }))
}

// ─── savePromptDraft ──────────────────────────────────────────────────────────

/**
 * Saves a prompt edit as a DRAFT version row.
 * This does NOT change active_prompt_version_id — the prompt does not go live until Publish.
 *
 * Mechanism: UPDATE agents SET system_prompt = newPrompt, updated_by = userId.
 * This triggers `trg_agent_prompt_version_snapshot` which inserts a new agent_prompt_versions row.
 * active_prompt_version_id remains unchanged — the new version is a draft.
 *
 * Returns the new version id.
 */
export async function savePromptDraft(
  agentId: string,
  newPrompt: string
): Promise<{ versionId: string; version: number } | { error: string }> {
  const user = await getUser()
  if (!user) return { error: 'Unauthorized' }

  const supabase = await createClient()

  // Set updated_by so the trigger can capture the author
  const { error: updateError } = await supabase
    .from('agents')
    .update({
      system_prompt: newPrompt,
      updated_by: user.id,
    })
    .eq('id', agentId)

  if (updateError) return { error: updateError.message }

  // Fetch the newly created version row (highest version for this agent)
  const { data: newVersion } = await supabase
    .from('agent_prompt_versions')
    .select('id, version')
    .eq('agent_id', agentId)
    .order('version', { ascending: false })
    .limit(1)
    .single()

  if (!newVersion) return { error: 'Version row not created by trigger — check migration 045' }

  revalidatePath(`/dashboard/agents/${agentId}`)
  revalidatePath(`/dashboard/agents/${agentId}/prompt-history`)
  return { versionId: newVersion.id, version: newVersion.version }
}

// ─── publishPromptVersion ─────────────────────────────────────────────────────

/**
 * Promotes a draft version to production by updating agents.active_prompt_version_id.
 * The version row is NEVER mutated (immutable invariant).
 * This makes the runtime immediately use the new prompt.
 */
export async function publishPromptVersion(
  agentId: string,
  versionId: string
): Promise<void | { error: string }> {
  const user = await getUser()
  if (!user) return { error: 'Unauthorized' }

  const supabase = await createClient()

  // Verify the version belongs to this agent
  const { data: version } = await supabase
    .from('agent_prompt_versions')
    .select('id, agent_id')
    .eq('id', versionId)
    .eq('agent_id', agentId)
    .single()

  if (!version) return { error: 'Version not found or does not belong to this agent' }

  const { error } = await supabase
    .from('agents')
    .update({ active_prompt_version_id: versionId, updated_by: user.id })
    .eq('id', agentId)

  if (error) return { error: error.message }

  revalidatePath(`/dashboard/agents/${agentId}`)
  revalidatePath(`/dashboard/agents/${agentId}/prompt-history`)
}

// ─── activatePromptVersion ────────────────────────────────────────────────────

/**
 * Rollback: activates a prior version (any version, not necessarily the latest).
 * Updates agents.active_prompt_version_id — version row is NEVER mutated.
 * Semantically identical to publishPromptVersion but named separately for clarity in UI.
 */
export async function activatePromptVersion(
  agentId: string,
  versionId: string
): Promise<void | { error: string }> {
  // Delegate to publish — same DB operation
  return publishPromptVersion(agentId, versionId)
}
```
</action>

<acceptance_criteria>
- `src/app/(dashboard)/agents/actions.ts` exports `getPromptVersionHistory`, `savePromptDraft`, `publishPromptVersion`, `activatePromptVersion`
- `savePromptDraft` does NOT directly insert into `agent_prompt_versions` — it triggers the DB trigger by UPDATE-ing `agents.system_prompt`
- `publishPromptVersion` UPDATE is only on `agents.active_prompt_version_id` (not on `agent_prompt_versions`)
- `getPromptVersionHistory` returns `is_active: boolean` field derived from `agent.active_prompt_version_id`
- `npm run build` exits 0
</acceptance_criteria>

#### Task 41-03-T02: Update updateAgent to Decouple system_prompt Write

<read_first>
- `src/app/(dashboard)/agents/actions.ts` — find the `updateAgent` server action (added in Phase 36 Plan 04)
</read_first>

<action>
Locate `updateAgent` in `src/app/(dashboard)/agents/actions.ts`.

Currently, `updateAgent` updates `system_prompt` as part of the general agent UPDATE. This is fine — the trigger will fire when it does. However, we need to ensure `updated_by` is ALWAYS set before an UPDATE that includes `system_prompt`, so the trigger can capture the author.

Review the existing `updateAgent` implementation. Ensure it:
1. Passes `updated_by: user.id` in every `.update({...})` call that might include `system_prompt`
2. Does NOT directly update `active_prompt_version_id` (that's exclusively done via `publishPromptVersion`)

If `updateAgent` currently updates `active_prompt_version_id` as part of form save, remove that — it should only update the agent fields, not promote the version.

The agent form's "Save" button calls `updateAgent` which writes `system_prompt` → trigger fires → new version row created (draft). The "Publish" button separately calls `publishPromptVersion`.
</action>

<acceptance_criteria>
- `updateAgent` function in `actions.ts` contains `updated_by: user.id` in its update payload
- `updateAgent` does NOT set `active_prompt_version_id` in its update payload
- `npm run build` exits 0
</acceptance_criteria>

### must_haves
- [ ] `getPromptVersionHistory` server action exists and is exported
- [ ] `savePromptDraft` triggers the DB trigger (does NOT bypass via direct INSERT)
- [ ] `publishPromptVersion` / `activatePromptVersion` only mutate `agents.active_prompt_version_id`
- [ ] Build passes

---

## Plan 41-04: Prompt History UI + Draft/Publish UX (Wave 2)

```yaml
wave: 2
depends_on: [41-02, 41-03]
files_modified:
  - src/app/(dashboard)/agents/[id]/prompt-history/page.tsx
  - src/components/agents/prompt-history-panel.tsx
  - src/components/agents/agent-form.tsx
  - src/app/(dashboard)/agents/[id]/page.tsx
autonomous: true
requirements: [AGENT-13, AGENT-14, AGENT-15]
```

### Objective

Build the Prompt History UI page at `/dashboard/agents/[id]/prompt-history` with: version list (author, timestamp, active badge), unified diff viewer against previous version, Activate/rollback button. Update the agent edit form's prompt section to show Save Draft + Publish separately.

### Tasks

#### Task 41-04-T01: Create PromptHistoryPanel Component

<read_first>
- `src/components/agents/agent-form.tsx` — existing agent form structure, imports, and styling patterns
- `src/components/agents/agents-table.tsx` — table component patterns used in agents dashboard
- `src/app/(dashboard)/agents/actions.ts` — `getPromptVersionHistory`, `publishPromptVersion`, `activatePromptVersion` signatures
- `src/components/ui/` — check available shadcn components: Badge, Button, Separator, Table, ScrollArea
</read_first>

<action>
Create `src/components/agents/prompt-history-panel.tsx`:

```typescript
'use client'

import { useState, useTransition } from 'react'
import { formatDistanceToNow } from 'date-fns'
import { toast } from 'sonner'
import { CheckCircle, Clock, RotateCcw } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { activatePromptVersion } from '@/app/(dashboard)/agents/actions'
import type { PromptVersionListItem } from '@/app/(dashboard)/agents/actions'

interface PromptHistoryPanelProps {
  agentId: string
  versions: PromptVersionListItem[]
}

export function PromptHistoryPanel({ agentId, versions }: PromptHistoryPanelProps) {
  const [selectedIdx, setSelectedIdx] = useState(0)
  const [isPending, startTransition] = useTransition()

  const selected = versions[selectedIdx]
  const previousVersion = versions[selectedIdx + 1] ?? null

  function handleActivate(versionId: string) {
    startTransition(async () => {
      const result = await activatePromptVersion(agentId, versionId)
      if (result && 'error' in result) {
        toast.error(result.error)
      } else {
        toast.success('Version activated — runtime now uses this prompt')
      }
    })
  }

  if (versions.length === 0) {
    return (
      <div className="text-sm text-muted-foreground p-4">
        No prompt versions recorded yet. Save the agent to create the first version.
      </div>
    )
  }

  return (
    <div className="flex gap-4 h-[600px]">
      {/* Version List */}
      <div className="w-64 shrink-0 border rounded-md">
        <ScrollArea className="h-full">
          <div className="p-2 space-y-1">
            {versions.map((v, idx) => (
              <button
                key={v.id}
                onClick={() => setSelectedIdx(idx)}
                className={`w-full text-left px-3 py-2 rounded-md text-sm transition-colors ${
                  idx === selectedIdx
                    ? 'bg-accent text-accent-foreground'
                    : 'hover:bg-muted'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-mono font-medium">v{v.version}</span>
                  {v.is_active && (
                    <Badge variant="default" className="text-xs px-1 py-0">Live</Badge>
                  )}
                </div>
                <div className="text-xs text-muted-foreground mt-0.5 truncate">
                  {v.created_by_email ?? 'Unknown'}
                </div>
                <div className="text-xs text-muted-foreground flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  {formatDistanceToNow(new Date(v.created_at), { addSuffix: true })}
                </div>
              </button>
            ))}
          </div>
        </ScrollArea>
      </div>

      {/* Version Detail + Diff */}
      <div className="flex-1 border rounded-md overflow-hidden flex flex-col">
        {selected && (
          <>
            <div className="px-4 py-3 border-b flex items-center justify-between">
              <div>
                <span className="font-mono font-semibold">Version {selected.version}</span>
                {selected.is_active && (
                  <Badge variant="default" className="ml-2 text-xs">Currently Live</Badge>
                )}
                <p className="text-xs text-muted-foreground mt-0.5">
                  by {selected.created_by_email ?? 'Unknown'} ·{' '}
                  {new Date(selected.created_at).toLocaleString()}
                </p>
              </div>
              {!selected.is_active && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={isPending}
                  onClick={() => handleActivate(selected.id)}
                  className="gap-1"
                >
                  <RotateCcw className="h-3 w-3" />
                  Activate
                </Button>
              )}
              {selected.is_active && (
                <div className="flex items-center gap-1 text-sm text-green-600">
                  <CheckCircle className="h-4 w-4" />
                  <span>Active</span>
                </div>
              )}
            </div>

            <ScrollArea className="flex-1 p-4">
              {previousVersion ? (
                <PromptDiff
                  label={`diff v${previousVersion.version} → v${selected.version}`}
                  before={previousVersion.system_prompt}
                  after={selected.system_prompt}
                />
              ) : (
                <div>
                  <p className="text-xs text-muted-foreground mb-2">Initial version (no previous to diff against)</p>
                  <pre className="text-xs font-mono whitespace-pre-wrap bg-muted rounded p-3">
                    {selected.system_prompt}
                  </pre>
                </div>
              )}
            </ScrollArea>
          </>
        )}
      </div>
    </div>
  )
}

// ─── Inline unified diff renderer ────────────────────────────────────────────

function PromptDiff({ label, before, after }: { label: string; before: string; after: string }) {
  // Line-level diff: show removed lines in red, added lines in green, unchanged in default
  const beforeLines = before.split('\n')
  const afterLines = after.split('\n')

  // Simple LCS-based line diff using longest common subsequence
  const diff = computeLineDiff(beforeLines, afterLines)

  return (
    <div>
      <p className="text-xs text-muted-foreground mb-2 font-mono">{label}</p>
      <div className="border rounded text-xs font-mono">
        {diff.map((chunk, idx) => (
          <div
            key={idx}
            className={
              chunk.type === 'removed'
                ? 'bg-red-50 text-red-800 px-3 py-0.5 border-l-2 border-red-400'
                : chunk.type === 'added'
                ? 'bg-green-50 text-green-800 px-3 py-0.5 border-l-2 border-green-400'
                : 'px-3 py-0.5 text-muted-foreground'
            }
          >
            {chunk.type === 'removed' ? '− ' : chunk.type === 'added' ? '+ ' : '  '}
            {chunk.line}
          </div>
        ))}
      </div>
    </div>
  )
}

type DiffChunk = { type: 'added' | 'removed' | 'unchanged'; line: string }

function computeLineDiff(before: string[], after: string[]): DiffChunk[] {
  // Myers diff algorithm (simplified O(ND) for line-level diffs)
  // For prompt versioning use case, prompts are <200 lines — O(N²) LCS is fine
  const m = before.length
  const n = after.length
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0))

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (before[i - 1] === after[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1])
      }
    }
  }

  const result: DiffChunk[] = []
  let i = m, j = n
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && before[i - 1] === after[j - 1]) {
      result.unshift({ type: 'unchanged', line: before[i - 1] })
      i--; j--
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      result.unshift({ type: 'added', line: after[j - 1] })
      j--
    } else {
      result.unshift({ type: 'removed', line: before[i - 1] })
      i--
    }
  }
  return result
}
```
</action>

<acceptance_criteria>
- `src/components/agents/prompt-history-panel.tsx` exists
- File exports `PromptHistoryPanel` component
- Component includes `activatePromptVersion` call wrapped in `useTransition`
- Component renders `Badge` with text "Live" for `is_active` versions
- Component renders "Activate" button for non-active versions with `disabled={isPending}`
- `PromptDiff` function exists inline and uses LCS algorithm
- `npm run build` exits 0
</acceptance_criteria>

#### Task 41-04-T02: Create Prompt History Page

<read_first>
- `src/app/(dashboard)/agents/[id]/page.tsx` — existing agent edit page structure and imports
- `src/app/(dashboard)/agents/actions.ts` — `getPromptVersionHistory` signature and `PromptVersionListItem`
- `src/components/agents/prompt-history-panel.tsx` — just created in T01
</read_first>

<action>
Create `src/app/(dashboard)/agents/[id]/prompt-history/page.tsx`:

```typescript
import { notFound } from 'next/navigation'
import { getAgentById, getPromptVersionHistory } from '../../actions'
import { PromptHistoryPanel } from '@/components/agents/prompt-history-panel'
import { Button } from '@/components/ui/button'
import Link from 'next/link'
import { ChevronLeft } from 'lucide-react'

type Props = { params: Promise<{ id: string }> }

export default async function PromptHistoryPage({ params }: Props) {
  const { id } = await params
  const [agent, versions] = await Promise.all([
    getAgentById(id),
    getPromptVersionHistory(id),
  ])
  if (!agent) notFound()

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="mb-4 flex items-center gap-3">
        <Button variant="ghost" size="sm" asChild className="gap-1">
          <Link href={`/dashboard/agents/${id}`}>
            <ChevronLeft className="h-4 w-4" />
            Back to {agent.name}
          </Link>
        </Button>
      </div>
      <div className="mb-6">
        <h1 className="text-lg font-semibold">Prompt History</h1>
        <p className="text-sm text-muted-foreground">
          {versions.length} version{versions.length !== 1 ? 's' : ''} · Click "Activate" to roll back to any prior version
        </p>
      </div>
      <PromptHistoryPanel agentId={id} versions={versions} />
    </div>
  )
}
```
</action>

<acceptance_criteria>
- `src/app/(dashboard)/agents/[id]/prompt-history/page.tsx` exists
- Page imports `getAgentById` and `getPromptVersionHistory` from `'../../actions'`
- Page imports `PromptHistoryPanel` from `'@/components/agents/prompt-history-panel'`
- Page returns `notFound()` when agent is not found
- `npm run build` exits 0 and the route compiles without error
</acceptance_criteria>

#### Task 41-04-T03: Update Agent Form — Save Draft + Publish Separately

<read_first>
- `src/components/agents/agent-form.tsx` — full file — find the form submit area and system_prompt field
- `src/app/(dashboard)/agents/actions.ts` — `savePromptDraft` and `publishPromptVersion` signatures
</read_first>

<action>
Modify `src/components/agents/agent-form.tsx` to change the prompt editing section behavior:

1. Add imports:
```typescript
import { savePromptDraft, publishPromptVersion } from '@/app/(dashboard)/agents/actions'
```

2. In the Identity/Prompt section of the form, find the `system_prompt` textarea field.

3. Add a "Prompt History" link beside the system_prompt label in edit mode:
```tsx
{/* Only show in edit mode */}
{mode === 'edit' && agentId && (
  <Link
    href={`/dashboard/agents/${agentId}/prompt-history`}
    className="text-xs text-muted-foreground hover:text-foreground underline-offset-2 hover:underline ml-auto"
  >
    View history
  </Link>
)}
```

4. In edit mode, add a "Save Prompt as Draft" button next to the prompt textarea that calls `savePromptDraft` with the current `system_prompt` value WITHOUT submitting the full form:
```tsx
{mode === 'edit' && agentId && (
  <Button
    type="button"
    variant="secondary"
    size="sm"
    disabled={isPending}
    onClick={async () => {
      const currentPrompt = form.getValues('system_prompt')
      startTransition(async () => {
        const result = await savePromptDraft(agentId, currentPrompt)
        if ('error' in result) {
          toast.error(result.error)
        } else {
          toast.success(`Draft v${result.version} saved — use Publish to make it live`)
        }
      })
    }}
  >
    Save Draft
  </Button>
)}
```

5. The main form "Save" button continues to call `updateAgent` as before — the trigger handles version creation. But the UX should convey that saving the full form also creates a draft. Update the submit button label in edit mode to "Save (creates draft)" or add a helper text below the submit area:
```tsx
{mode === 'edit' && (
  <p className="text-xs text-muted-foreground">
    Saving creates a draft version.{' '}
    <Link href={`/dashboard/agents/${agentId}/prompt-history`} className="underline">
      Publish from the history page
    </Link>{' '}
    to make it live.
  </p>
)}
```

Note: Do NOT add a Publish button to the form itself — publishing happens from the prompt-history page to enforce the explicit promotion flow (AGENT-15).
</action>

<acceptance_criteria>
- `src/components/agents/agent-form.tsx` imports `savePromptDraft` from `'@/app/(dashboard)/agents/actions'`
- File contains `href={`/dashboard/agents/${agentId}/prompt-history`}` link (view history)
- File contains a "Save Draft" button that calls `savePromptDraft` without full form submit
- File does NOT contain a "Publish" button (publishing is exclusively on the history page)
- File contains helper text mentioning "creates a draft version" in edit mode
- `npm run build` exits 0
</acceptance_criteria>

#### Task 41-04-T04: Add History Link from Agent Edit Page

<read_first>
- `src/app/(dashboard)/agents/[id]/page.tsx` — current edit page header
</read_first>

<action>
Add a "Prompt History" link to the agent edit page header in `src/app/(dashboard)/agents/[id]/page.tsx`:

```tsx
<div className="mb-4 flex items-center justify-between">
  <div>
    <h1 className="text-lg font-semibold">{agent.name}</h1>
    <p className="text-sm text-muted-foreground font-mono">{agent.slug}</p>
  </div>
  <Button variant="outline" size="sm" asChild>
    <Link href={`/dashboard/agents/${id}/prompt-history`}>
      Prompt History
    </Link>
  </Button>
</div>
```

Add necessary imports: `import Link from 'next/link'` and `import { Button } from '@/components/ui/button'`.
</action>

<acceptance_criteria>
- `src/app/(dashboard)/agents/[id]/page.tsx` contains a Link to `/dashboard/agents/${id}/prompt-history`
- `npm run build` exits 0
</acceptance_criteria>

### must_haves
- [ ] `PromptHistoryPanel` component exists with version list, diff viewer, and Activate button
- [ ] `/dashboard/agents/[id]/prompt-history` page route exists and compiles
- [ ] Agent edit form has "Save Draft" button and "View history" link
- [ ] No Publish button on the form itself (publish-only on history page — AGENT-15 invariant)
- [ ] Build passes

---

## Plan 41-05: Integration Tests + Build Gate (Wave 3)

```yaml
wave: 3
depends_on: [41-02, 41-03, 41-04]
files_modified:
  - tests/agent-prompt-versioning.test.ts
autonomous: true
requirements: [AGENT-11, AGENT-12, AGENT-13, AGENT-14, AGENT-15]
```

### Objective

Implement the test stubs from Plan 41-01 into full passing tests. Verify all 5 AGENT requirements. Run the full test suite and build gate.

### Tasks

#### Task 41-05-T01: Implement AGENT-11 Tests (DB Trigger)

<read_first>
- `tests/agent-prompt-versioning.test.ts` — stubs from Plan 41-01
- `tests/run-agent.test.ts` — existing mock pattern for Supabase service client
- `src/app/(dashboard)/agents/actions.ts` — `savePromptDraft`, `getPromptVersionHistory`
- `supabase/migrations/045_agent_prompt_version_trigger.sql` — trigger logic to understand what to mock
</read_first>

<action>
Since the DB trigger runs in Supabase and cannot be invoked in Vitest unit tests, test AGENT-11 at the server-action level by:

1. Mocking the Supabase client's `update` call to simulate the trigger's side effect: when `agents.update` is called with a new `system_prompt`, the mock also populates the `agent_prompt_versions` insert.

2. OR: Test the trigger behavior in a Supabase integration test that connects to the real DB (use `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` from env if present, otherwise skip).

Implement AGENT-11 tests:

```typescript
describe('AGENT-11: DB trigger auto-snapshots system_prompt on UPDATE', () => {
  it('updating agents.system_prompt creates a new agent_prompt_versions row', async () => {
    // Integration: call savePromptDraft and verify version count increases
    // If DB env vars not present, use mock to verify the action calls .update() with system_prompt
    const { savePromptDraft } = await import('@/app/(dashboard)/agents/actions')
    // Mock setup: vi.mock supabase client
    // Assert: savePromptDraft calls supabase.from('agents').update() with system_prompt in payload
    // The trigger side effect (INSERT into agent_prompt_versions) is verified by getPromptVersionHistory
  })

  it('updating agents.system_prompt to the same value does NOT create a new version row', async () => {
    // Trigger guard: IF NEW.system_prompt IS NOT DISTINCT FROM OLD.system_prompt THEN RETURN NEW
    // Test: verify the trigger condition — same prompt → no INSERT (verified via mock count)
  })
})
```

For AGENT-12, implement the key invariant test:

```typescript
describe('AGENT-12: runtime always uses active_prompt_version_id, never agents.system_prompt directly', () => {
  it('resolve-agent reads system_prompt from agent_prompt_versions row via active_prompt_version_id', async () => {
    // Mock supabase to return:
    //   agents row: system_prompt = 'OLD PROMPT', active_prompt_version_id = 'version-uuid'
    //   agent_prompt_versions row: system_prompt = 'VERSION PROMPT'
    // Assert: resolveAgent returns 'VERSION PROMPT', not 'OLD PROMPT'
    vi.mock('@/lib/supabase/admin', () => ({
      createServiceRoleClient: () => ({
        from: (table: string) => ({
          select: () => ({
            eq: () => ({
              eq: () => ({
                single: async () => ({
                  data: table === 'agents' ? {
                    id: 'agent-1',
                    name: 'Test Agent',
                    model: 'claude-haiku-4-5',
                    max_history: 20,
                    fallback_message: 'Fallback',
                    allowed_channels: ['web_widget'],
                    channel_overrides: null,
                    is_active: true,
                    active_prompt_version_id: 'version-uuid',
                    kb_scope: null,
                    agent_prompt_versions: { id: 'version-uuid', system_prompt: 'VERSION PROMPT' },
                  } : null,
                  error: null,
                }),
              }),
            }),
          }),
        }),
      }),
    }))

    const { resolveAgent } = await import('@/lib/agent-runtime/resolve-agent')
    const result = await resolveAgent('agent-1', 'org-1', 'web_widget')
    expect(result).not.toBeNull()
    expect(result!.systemPrompt).toBe('VERSION PROMPT')
  })

  it('resolveAgent returns null when active_prompt_version_id is null (no fallback to system_prompt)', async () => {
    // Mock: active_prompt_version_id = null, agent_prompt_versions = null
    // Assert: resolveAgent returns null
  })
})
```

For AGENT-14 and AGENT-15, test server action behavior:

```typescript
describe('AGENT-15: draft/publish flow', () => {
  it('savePromptDraft calls agents.update() with system_prompt but NOT active_prompt_version_id', async () => {
    // Mock supabase from/update, verify the update payload contains system_prompt
    // AND does NOT contain active_prompt_version_id
  })

  it('publishPromptVersion updates only active_prompt_version_id', async () => {
    // Mock supabase, verify update payload is { active_prompt_version_id: 'x', updated_by: 'user-id' }
    // AND does NOT contain system_prompt
  })
})
```
</action>

<acceptance_criteria>
- `tests/agent-prompt-versioning.test.ts` contains no `.todo` calls — all stubs implemented
- `npx vitest run tests/agent-prompt-versioning.test.ts` exits 0 with all tests GREEN
- AGENT-12 test verifies `result.systemPrompt === 'VERSION PROMPT'` (from version row, not from `agents.system_prompt`)
- AGENT-15 test verifies `savePromptDraft` does NOT include `active_prompt_version_id` in its update payload
- AGENT-14 test verifies `activatePromptVersion` does NOT mutate the version row
</acceptance_criteria>

#### Task 41-05-T02: Full Suite + Build Gate

<read_first>
- `package.json` — test and build commands
</read_first>

<action>
1. Run `npx vitest run` — full test suite must pass (0 failures, todos excluded from count)
2. Run `npm run build` — TypeScript production build must exit 0
3. Run `npm run lint` — ESLint must exit 0

If any failures, investigate and fix. Common issues:
- `date-fns` not installed — add `npm install date-fns`
- Missing shadcn `ScrollArea` component — run `npx shadcn@latest add scroll-area`
- Import path errors in the new page component
</action>

<acceptance_criteria>
- `npx vitest run` exits 0
- `npm run build` exits 0
- `npm run lint` exits 0 (or exits with only pre-existing warnings)
- `tests/agent-prompt-versioning.test.ts` shows X passed, 0 failed in vitest output
</acceptance_criteria>

### must_haves
- [ ] All AGENT-11 through AGENT-15 test stubs implemented and passing
- [ ] `resolveAgent` null-on-missing-version behavior verified by test
- [ ] Full vitest suite GREEN
- [ ] `npm run build` passes
- [ ] `npm run lint` passes

---

## Phase Verification

### Must-Haves (goal-backward)

Derived from Phase 41 goal: "immutable version rows, runtime reads from active version, explicit Publish, one-click rollback"

- [ ] DB trigger `trg_agent_prompt_version_snapshot` exists in migration 045 and fires on `agents.system_prompt` UPDATE
- [ ] `resolve-agent.ts` never reads `agents.system_prompt` as fallback — returns null when version missing
- [ ] `savePromptDraft` exists and does NOT update `active_prompt_version_id`
- [ ] `publishPromptVersion` + `activatePromptVersion` exist and only mutate `agents.active_prompt_version_id`
- [ ] `/dashboard/agents/[id]/prompt-history` page exists and renders version list with Activate buttons
- [ ] `PromptHistoryPanel` renders inline diff via LCS algorithm
- [ ] Agent edit form has "Save Draft" button and "View history" link — no Publish button on form
- [ ] `npm run build` exits 0
- [ ] All AGENT-11 through AGENT-15 tests passing

### AGENT Requirements Coverage

| REQ-ID | Covered By | Test |
|--------|-----------|------|
| AGENT-11 | Plan 41-01 (migration 045 trigger) | AGENT-11 describe block |
| AGENT-12 | Plan 41-02 (resolve-agent hardening) | AGENT-12 describe block |
| AGENT-13 | Plan 41-04 (PromptHistoryPanel) | AGENT-13 describe block |
| AGENT-14 | Plan 41-03 + 41-04 (activatePromptVersion + Activate button) | AGENT-14 describe block |
| AGENT-15 | Plan 41-03 + 41-04 (savePromptDraft separate from publish) | AGENT-15 describe block |

---

## Key Decisions and Constraints

| Decision | Value | Rationale |
|---|---|---|
| Trigger mechanism | DB trigger on `agents.system_prompt` UPDATE | Atomic — cannot be bypassed by any server path; guarantees version created even from Supabase Dashboard edits |
| Draft mechanism | `savePromptDraft` → trigger → new version row; `active_prompt_version_id` stays | Decouples "create" from "promote" without a separate draft state column |
| Version immutability | `activatePromptVersion` only updates `agents.active_prompt_version_id` | Version rows are append-only; rollback is pointer swap not mutation |
| Diff algorithm | LCS (O(N²)) inline in component | Prompts are <200 lines; no external diff library needed |
| Author capture | `agents.updated_by` set before UPDATE so trigger reads it | Trigger runs in same transaction; `updated_by` is reliable |
| Runtime fallback removal | `resolveAgent` returns null on missing version | Forces proper seeding; prevents silent prompt corruption |
| Publish location | Only on `/prompt-history` page, NOT on the edit form | Enforces the "no auto-promote on save" invariant (AGENT-15) |
