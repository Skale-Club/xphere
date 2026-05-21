---
id: SEED-046
status: dormant
planted: 2026-05-21
planted_during: v2.8 post-ship — canvas visual refinement (SEED-043)
trigger_when: next milestone that includes flow execution hardening, or when a user reports that "Create task" node silently fails at runtime
scope: Medium
depends_on: []
---

# SEED-046: Implement Native create_task (and create_note) Flow Executor

## Why This Matters

The `create_task` and `create_note` action nodes exist in the flow canvas UI
and the AI builder, but they have **no runtime executor**. If a workflow
reaches one of these nodes, the engine throws:

```
Error: Unknown action type: create_task
```

This is a silent failure — the user builds the workflow, saves it, hits
"Run now", and nothing happens (or they get an opaque error in the logs).

**Root cause:** `create_task` is not in the DB `action_type` enum
(`src/types/database.ts:418`), and `execute-action.ts` has no `case` for it.
The platform already has a complete native task system (`tasks` table,
`createTask()` server action), so this is purely a wiring gap.

## What Needs to Change

### 1. DB migration — add enum values

```sql
ALTER TYPE action_type ADD VALUE IF NOT EXISTS 'create_task';
ALTER TYPE action_type ADD VALUE IF NOT EXISTS 'create_note';
```

New migration file in `supabase/migrations/`.

### 2. Update `src/types/database.ts`

Add `'create_task'` and `'create_note'` to the `action_type` union in all
four spots (Insert, Update, Row, Enum) — or regenerate via
`npx supabase gen types`.

### 3. Add executor in `src/lib/action-engine/executors/`

Create `create-task.ts`:

```typescript
// Inserts a task into the platform's tasks table using the service role client
// (workflows run outside auth context).

import { createServiceRoleClient } from '@/lib/supabase/admin'

export async function executeCreateTask(
  params: Record<string, unknown>,
  orgId: string,
): Promise<string> {
  const supabase = createServiceRoleClient()
  const title = String(params.title ?? params.name ?? '')
  if (!title) throw new Error('create_task: title is required')

  const { data, error } = await supabase
    .from('tasks')
    .insert({
      org_id: orgId,
      title,
      description: params.description ? String(params.description) : null,
      due_date: params.due_date ? String(params.due_date) : null,
      priority: (['low', 'medium', 'high', 'urgent'].includes(String(params.priority))
        ? params.priority
        : 'medium') as 'low' | 'medium' | 'high' | 'urgent',
      status: 'todo',
    })
    .select('id')
    .single()

  if (error) throw new Error(`create_task failed: ${error.message}`)
  return `Task created: ${data.id}`
}
```

Create `create-note.ts` similarly (inserts into `contact_notes` or equivalent
notes table — verify schema before implementing).

### 4. Wire into `src/lib/action-engine/execute-action.ts`

```typescript
case 'create_task': {
  if (!ctx?.organizationId) throw new Error('create_task requires ctx.organizationId')
  return executeCreateTask(params, ctx.organizationId)
}
case 'create_note': {
  if (!ctx?.organizationId) throw new Error('create_note requires ctx.organizationId')
  return executeCreateNote(params, ctx.organizationId)
}
```

### 5. Verify `node-config-panel.tsx` captures the right fields

`src/components/flows/node-config-panel.tsx:581` — the `create_task` config
block currently only has a `title` textarea. Consider adding:
- `description` (optional, multiline)
- `due_date` (optional date picker or text field)
- `priority` (select: low / medium / high / urgent)

These are all columns in the `tasks` table and make the action genuinely useful.

## Scope Estimate

**Medium** — one migration + two executor files + wiring + config panel expansion.
One phase, 3-4 tasks.

## Breadcrumbs

- `src/lib/action-engine/execute-action.ts:164` — `default` case that throws
  "Unknown action type"; `create_task` hits this
- `src/types/database.ts:418` — `action_type` enum missing `create_task`
- `src/components/flows/node-config-panel.tsx:581-596` — canvas UI for
  `create_task` (title-only today)
- `src/app/(dashboard)/tasks/actions.ts:58` — native `createTask()` server action
  (schema reference: title, description, due_date, priority, status, assigned_to,
  entity_type, entity_id)
- `src/lib/copilot/tools/tasks.ts:115` — Copilot already has a working
  `create_task` tool that calls the native tasks table; copy the pattern
- `supabase/migrations/` — add new migration here; never edit existing ones
