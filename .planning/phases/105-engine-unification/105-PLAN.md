---
phase: 105-engine-unification
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/lib/flows/engine.ts
  - src/lib/flows/executors.ts
autonomous: true
requirements:
  - ENG-01
  - ENG-02
  - ENG-03

must_haves:
  truths:
    - "Flow engine action nodes execute through the shared Action Engine (executeAction) instead of executors.ts stubs"
    - "Flow-internal action types (http_request, log, booking_*) continue working from engine.ts after being moved inline"
    - "All 20+ shared action types (create_contact, pipeline_*, send_sms, etc.) are reached via executeAction delegation"
    - "executors.ts is deleted with no broken imports anywhere in the codebase"
    - "Existing npx vitest test suite passes with no regressions"
    - "The flow engine has no action-specific switch/if-else for shared action types — only flow-internal types are dispatched inline"
  artifacts:
    - path: "src/lib/flows/engine.ts"
      provides: "Unified action execution (inline flow-internal executors + executeAction delegation)"
      min_lines: 350
    - path: "src/lib/flows/executors.ts"
      provides: "Deleted — no longer exists"
      min_lines: 0
    - path: "src/lib/action-engine/execute-action.ts"
      provides: "Canonical execution path — unchanged, still passes existing tests"
  key_links:
    - from: "src/lib/flows/engine.ts"
      to: "src/lib/action-engine/execute-action.ts"
      via: "import + executeAction() call for shared action types"
      pattern: "import.*executeAction.*from"
    - from: "src/lib/flows/engine.ts"
      to: "src/lib/ghl/client.ts"
      via: "resolveGhlCredentials() helper (decrypt + build GhlCredentials)"
      pattern: "import.*GhlCredentials"
    - from: "src/lib/flows/engine.ts"
      to: "src/lib/crypto.ts"
      via: "decrypt() call for encrypted API keys"
      pattern: "import.*decrypt.*from"
---

<objective>
**What:** Refactor `src/lib/flows/engine.ts` to delegate action execution to the shared Action Engine's `executeAction()` instead of dispatching to `src/lib/flows/executors.ts`.

**Purpose:** Eliminate the dual-path anti-pattern where the flow engine maintained its own stub executors while the Action Engine had real implementations. All action types now execute through one canonical path.

**Output:**
- Modified `engine.ts` — flow-internal executors (`http_request`, `log`, `booking_*`) moved inline; all other action types delegate to `executeAction()`
- Deleted `executors.ts` — all action coverage verified through the unified path
- No regressions in existing test suite
</objective>

<execution_context>
@$HOME/.config/opencode/get-shit-done/workflows/execute-plan.md
@$HOME/.config/opencode/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/phases/105-engine-unification/105-CONTEXT.md
@.planning/REQUIREMENTS.md
@.planning/PROJECT.md
@src/lib/flows/engine.ts
@src/lib/flows/executors.ts
@src/lib/action-engine/execute-action.ts
@src/lib/ghl/client.ts
@src/lib/crypto.ts
@src/lib/flows/schema.ts
@tests/action-engine.test.ts

<interfaces>
<!-- Key contracts the executor needs. Extracted from codebase. -->

From src/lib/action-engine/execute-action.ts:
```typescript
interface ActionContext {
  organizationId: string
  supabase: SupabaseClient<Database>
  toolConfig?: Json
  integrationProvider?: IntegrationProvider
  delegationChain?: string[]
}

executeAction(
  actionType: ActionType,
  params: Record<string, unknown>,
  credentials: GhlCredentials,
  ctx?: ActionContext
): Promise<string>
```

From src/lib/ghl/client.ts:
```typescript
interface GhlCredentials {
  apiKey: string
  locationId: string
}
```

From src/lib/flows/schema.ts (action-specific fields):
```typescript
// FlowNodeData discriminated union includes:
ActionNodeData = {
  kind: 'action',
  action_type: string,  // wide string, not narrowed to ActionType union
  config: Record<string, unknown>,
  credential_ref?: string,
  label: string,
}
```

From src/lib/crypto.ts:
```typescript
decrypt(encrypted: string): Promise<string>
```

From src/lib/flows/engine.ts (current ExecutorContext — will be local to engine.ts):
```typescript
interface ExecutorContext {
  orgId: string
  supabase: SupabaseClient<Database>
  state: Record<string, unknown>
}
```
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Refactor engine.ts — inline flow-internal executors + delegate shared actions to executeAction()</name>
  <files>
    src/lib/flows/engine.ts
  </files>
  <action>
    Modify `src/lib/flows/engine.ts` to:

    **1. Update imports (lines 8-14):**
    - Remove: `import { executeNode, type ExecutorContext } from './executors'`
    - Add:
      ```typescript
      import { executeAction } from '@/lib/action-engine/execute-action'
      import type { ActionContext } from '@/lib/action-engine/execute-action'
      import { decrypt } from '@/lib/crypto'
      import type { GhlCredentials } from '@/lib/ghl/client'
      ```

    **2. Keep existing:** All imports, `RunInput`, `RunResult`, `runFlow`, `extractNodeConfig`, `pickNextNode`, `finalizeRun` — these are unchanged.

    **3. Replace `ExecutorContext` with local type:**
    ```typescript
    interface FlowExecutorContext {
      orgId: string
      supabase: SupabaseClient<Database>
      state: Record<string, unknown>
    }
    ```
    (Same shape as current `ExecutorContext`, now local to engine.ts — named distinctly to avoid confusion with `ActionContext`.)

    **4. Add credential resolution helper:**
    ```typescript
    async function resolveGhlCredentials(
      orgId: string,
      supabase: SupabaseClient<Database>,
    ): Promise<GhlCredentials> {
      const { data: integration } = await supabase
        .from('integrations')
        .select('encrypted_api_key, location_id')
        .eq('organization_id', orgId)
        .eq('provider', 'gohighlevel')
        .eq('is_active', true)
        .maybeSingle()

      if (!integration?.encrypted_api_key) {
        return { apiKey: '', locationId: '' }
      }

      const apiKey = await decrypt(integration.encrypted_api_key)
      return { apiKey, locationId: integration.location_id ?? '' }
    }
    ```

    **5. Add flow-internal executors (moved from executors.ts):**

    See below for full list of functions to inline. These executors are **flow-internal** — they handle action types that are NOT in the shared Action Engine's enum (`http_request`, `log`, `booking_*`):

    ```typescript
    // ─── Flow-internal: http_request ──────────────────────────────────────────
    async function executeHttpRequest(
      config: Record<string, unknown>,
    ): Promise<Record<string, unknown>> {
      const url = String(config.url ?? '')
      if (!url) throw new Error('http_request requires a url')

      const method = String(config.method ?? 'GET').toUpperCase()
      const headers = (config.headers as Record<string, string>) ?? { 'Content-Type': 'application/json' }
      const body = config.body
      const init: RequestInit = { method, headers }
      if (body !== undefined && body !== null && method !== 'GET') {
        init.body = typeof body === 'string' ? body : JSON.stringify(body)
      }

      const response = await fetch(url, init)
      const text = await response.text()
      let parsed: unknown = text
      try { parsed = JSON.parse(text) } catch { /* keep text */ }

      return {
        status: response.status,
        ok: response.ok,
        body: parsed,
      }
    }

    // ─── Flow-internal: log (debug no-op) ─────────────────────────────────────
    async function executeLog(config: Record<string, unknown>): Promise<Record<string, unknown>> {
      console.log('[flow:log]', JSON.stringify(config))
      return { logged: true, payload: config }
    }

    // ─── Flow-internal: booking_* executors ─────────────────────────────────────
    // These manipulate the bookings table directly via ctx.supabase.
    // They stay in engine.ts because they are flow-specific operations, not general
    // action types available in the Action Engine.
    //
    // Booking status type aligned with DB enum + aspirational transitions
    type BookingStatus = 'confirmed' | 'cancelled' | 'no_show' | 'pending' | 'completed'

    async function executeBookingConfirm(
      config: Record<string, unknown>,
      ctx: FlowExecutorContext,
    ): Promise<Record<string, unknown>> {
      const bookingId = String(config.booking_id ?? '')
      if (!bookingId) throw new Error('booking_confirm requires booking_id')

      const { data: booking, error: fetchErr } = await ctx.supabase
        .from('bookings')
        .select('id, status')
        .eq('id', bookingId)
        .single()

      if (fetchErr || !booking) throw new Error(`booking_confirm: booking not found (${bookingId})`)

      const current = booking.status as BookingStatus
      if (current !== 'pending' && current !== 'confirmed') {
        throw new Error(`booking_confirm: cannot confirm a booking with status '${current}' (must be pending)`)
      }
      if (current === 'confirmed') {
        return { booking_id: bookingId, status: 'confirmed', ok: true }
      }

      const { error: updateErr } = await ctx.supabase
        .from('bookings')
        .update({ status: 'confirmed', updated_at: new Date().toISOString() })
        .eq('id', bookingId)

      if (updateErr) throw new Error(`booking_confirm: update failed | ${updateErr.message}`)
      return { booking_id: bookingId, status: 'confirmed', ok: true }
    }

    async function executeBookingCancel(
      config: Record<string, unknown>,
      ctx: FlowExecutorContext,
    ): Promise<Record<string, unknown>> {
      const bookingId = String(config.booking_id ?? '')
      if (!bookingId) throw new Error('booking_cancel requires booking_id')

      const { data: booking, error: fetchErr } = await ctx.supabase
        .from('bookings')
        .select('id, status')
        .eq('id', bookingId)
        .single()

      if (fetchErr || !booking) throw new Error(`booking_cancel: booking not found (${bookingId})`)

      const current = booking.status as BookingStatus
      const cancellableStatuses: BookingStatus[] = ['pending', 'confirmed']
      if (!cancellableStatuses.includes(current)) {
        throw new Error(`booking_cancel: cannot cancel a booking with status '${current}'`)
      }

      const { error: updateErr } = await ctx.supabase
        .from('bookings')
        .update({ status: 'cancelled', updated_at: new Date().toISOString() })
        .eq('id', bookingId)

      if (updateErr) throw new Error(`booking_cancel: update failed | ${updateErr.message}`)
      return { booking_id: bookingId, status: 'cancelled', ok: true }
    }

    async function executeBookingReschedule(
      config: Record<string, unknown>,
      ctx: FlowExecutorContext,
    ): Promise<Record<string, unknown>> {
      const bookingId = String(config.booking_id ?? '')
      const startAt = String(config.start_at ?? '')
      const endAt = String(config.end_at ?? '')
      if (!bookingId) throw new Error('booking_reschedule requires booking_id')
      if (!startAt) throw new Error('booking_reschedule requires start_at')
      if (!endAt) throw new Error('booking_reschedule requires end_at')

      const { data: booking, error: fetchErr } = await ctx.supabase
        .from('bookings')
        .select('id, status')
        .eq('id', bookingId)
        .single()

      if (fetchErr || !booking) throw new Error(`booking_reschedule: booking not found (${bookingId})`)

      const current = booking.status as BookingStatus
      const reschedulableStatuses: BookingStatus[] = ['pending', 'confirmed']
      if (!reschedulableStatuses.includes(current)) {
        throw new Error(`booking_reschedule: cannot reschedule a booking with status '${current}'`)
      }

      const { error: updateErr } = await ctx.supabase
        .from('bookings')
        .update({ start_at: startAt, end_at: endAt, updated_at: new Date().toISOString() })
        .eq('id', bookingId)

      if (updateErr) throw new Error(`booking_reschedule: update failed | ${updateErr.message}`)
      return { booking_id: bookingId, start_at: startAt, end_at: endAt, ok: true }
    }

    async function executeBookingMarkNoShow(
      config: Record<string, unknown>,
      ctx: FlowExecutorContext,
    ): Promise<Record<string, unknown>> {
      const bookingId = String(config.booking_id ?? '')
      if (!bookingId) throw new Error('booking_mark_no_show requires booking_id')

      const { data: booking, error: fetchErr } = await ctx.supabase
        .from('bookings')
        .select('id, status')
        .eq('id', bookingId)
        .single()

      if (fetchErr || !booking) throw new Error(`booking_mark_no_show: booking not found (${bookingId})`)

      const current = booking.status as BookingStatus
      if (current !== 'confirmed') {
        throw new Error(`booking_mark_no_show: can only mark no_show from 'confirmed', got '${current}'`)
      }

      const { error: updateErr } = await ctx.supabase
        .from('bookings')
        .update({ status: 'no_show', updated_at: new Date().toISOString() })
        .eq('id', bookingId)

      if (updateErr) throw new Error(`booking_mark_no_show: update failed | ${updateErr.message}`)
      return { booking_id: bookingId, status: 'no_show', ok: true }
    }

    async function executeBookingMarkComplete(
      config: Record<string, unknown>,
      ctx: FlowExecutorContext,
    ): Promise<Record<string, unknown>> {
      const bookingId = String(config.booking_id ?? '')
      if (!bookingId) throw new Error('booking_mark_complete requires booking_id')

      const { data: booking, error: fetchErr } = await ctx.supabase
        .from('bookings')
        .select('id, status')
        .eq('id', bookingId)
        .single()

      if (fetchErr || !booking) throw new Error(`booking_mark_complete: booking not found (${bookingId})`)

      const current = booking.status as BookingStatus
      if (current !== 'confirmed') {
        throw new Error(`booking_mark_complete: can only mark completed from 'confirmed', got '${current}'`)
      }

      const { error: updateErr } = await ctx.supabase
        .from('bookings')
        .update({ status: 'completed' as 'confirmed', updated_at: new Date().toISOString() })
        .eq('id', bookingId)

      if (updateErr) throw new Error(`booking_mark_complete: update failed | ${updateErr.message}`)
      return { booking_id: bookingId, status: 'completed', ok: true }
    }

    async function executeBookingCreate(
      config: Record<string, unknown>,
      ctx: FlowExecutorContext,
    ): Promise<Record<string, unknown>> {
      const eventTypeId = String(config.event_type_id ?? '')
      const bookerName = String(config.booker_name ?? '')
      const bookerEmail = String(config.booker_email ?? '')
      const startAt = String(config.start_at ?? '')
      const endAt = String(config.end_at ?? '')
      if (!eventTypeId) throw new Error('booking_create requires event_type_id')
      if (!bookerName) throw new Error('booking_create requires booker_name')
      if (!bookerEmail) throw new Error('booking_create requires booker_email')
      if (!startAt) throw new Error('booking_create requires start_at')
      if (!endAt) throw new Error('booking_create requires end_at')

      const bookerPhone = config.booker_phone ? String(config.booker_phone) : null
      const bookerTimezone = config.booker_timezone ? String(config.booker_timezone) : 'UTC'
      const notes = config.notes ? String(config.notes) : null
      const linkedContactId = config.linked_contact_id ? String(config.linked_contact_id) : null

      const { data: newBooking, error: insertErr } = await ctx.supabase
        .from('bookings')
        .insert({
          org_id: ctx.orgId,
          event_type_id: eventTypeId,
          booker_name: bookerName,
          booker_email: bookerEmail,
          booker_phone: bookerPhone,
          booker_timezone: bookerTimezone,
          start_at: startAt,
          end_at: endAt,
          notes,
          status: 'confirmed',
          linked_contact_id: linkedContactId,
        })
        .select('id, status, start_at, end_at')
        .single()

      if (insertErr || !newBooking) {
        throw new Error(`booking_create: insert failed | ${insertErr?.message ?? 'unknown error'}`)
      }

      return {
        booking_id: newBooking.id,
        status: newBooking.status,
        start_at: newBooking.start_at,
        end_at: newBooking.end_at,
        ok: true,
      }
    }

    async function executeBookingGet(
      config: Record<string, unknown>,
      ctx: FlowExecutorContext,
    ): Promise<Record<string, unknown>> {
      const bookingId = String(config.booking_id ?? '')
      if (!bookingId) throw new Error('booking_get requires booking_id')

      const { data: booking, error: fetchErr } = await ctx.supabase
        .from('bookings')
        .select('id, status, event_type_id, booker_name, booker_email, booker_phone, start_at, end_at, notes, linked_contact_id, meeting_url, created_at, updated_at')
        .eq('id', bookingId)
        .single()

      if (fetchErr || !booking) throw new Error(`booking_get: booking not found (${bookingId})`)

      return {
        booking_id: booking.id,
        status: booking.status,
        event_type_id: booking.event_type_id,
        booker_name: booking.booker_name,
        booker_email: booking.booker_email,
        booker_phone: booking.booker_phone,
        start_at: booking.start_at,
        end_at: booking.end_at,
        notes: booking.notes,
        linked_contact_id: booking.linked_contact_id,
        meeting_url: booking.meeting_url,
        created_at: booking.created_at,
        updated_at: booking.updated_at,
        ok: true,
      }
    }

    // ─── Dispatcher: routes action execution based on node kind ────────────────
    // This replaces the executeNode() import from executors.ts.
    // Non-action nodes (trigger, end, condition, wait, agent) return empty output.
    // Action nodes with flow-internal types (http_request, log, booking_*) are
    // executed inline. All other action types delegate to executeAction().
    async function executeFlowNode(
      node: { id: string; type: string; data: FlowNodeData },
      resolvedConfig: Record<string, unknown>,
      ctx: FlowExecutorContext,
    ): Promise<Record<string, unknown>> {
      const data = node.data

      // Non-action nodes — no execution needed (handled by engine.ts walk logic)
      if (data.kind === 'trigger' || data.kind === 'end' || data.kind === 'condition') {
        return {}
      }

      if (data.kind === 'wait') {
        return {
          _wait_mode: data.mode,
          _wait_duration: data.duration ?? null,
          _wait_skipped: true,
          _note: 'Wait nodes are recorded but do not suspend execution in this engine version.',
        }
      }

      if (data.kind === 'agent') {
        return {
          _stub: true,
          _agent_id: data.agent_id ?? null,
          _note: 'Agent nodes are stubbed until Phase B agent runtime wiring.',
        }
      }

      // ── Action node ───────────────────────────────────────────────────────────
      if (data.kind === 'action') {
        switch (data.action_type) {
          // Flow-internal action types (not in shared Action Engine):
          case 'http_request':
            return executeHttpRequest(resolvedConfig)
          case 'log':
            return executeLog(resolvedConfig)

          // Booking actions (flow-specific, operate directly on bookings table):
          case 'booking_confirm':
            return executeBookingConfirm(resolvedConfig, ctx)
          case 'booking_cancel':
            return executeBookingCancel(resolvedConfig, ctx)
          case 'booking_reschedule':
            return executeBookingReschedule(resolvedConfig, ctx)
          case 'booking_mark_no_show':
            return executeBookingMarkNoShow(resolvedConfig, ctx)
          case 'booking_mark_complete':
            return executeBookingMarkComplete(resolvedConfig, ctx)
          case 'booking_create':
            return executeBookingCreate(resolvedConfig, ctx)
          case 'booking_get':
            return executeBookingGet(resolvedConfig, ctx)

          // All shared action types — delegate to the Action Engine.
          // This covers: create_contact, get_availability, create_appointment,
          // send_sms, knowledge_base, custom_webhook, manychat_* (4),
          // google_contacts_* (4), send_whatsapp_message, send_whatsapp_mention_all,
          // send_telegram_notification, pipeline_* (6), create_task, create_note.
          default: {
            const credentials = await resolveGhlCredentials(ctx.orgId, ctx.supabase)
            const actionCtx: ActionContext = {
              organizationId: ctx.orgId,
              supabase: ctx.supabase,
            }
            const result = await executeAction(
              data.action_type as Database['public']['Enums']['action_type'],
              resolvedConfig,
              credentials,
              actionCtx,
            )
            return { result }
          }
        }
      }

      return {}
    }
    ```
    Note: The `default` case in the action switch uses a type assertion for `action_type` because `FlowNodeData.action_type` is `string` (wide) while `executeAction` expects the narrowed `ActionType` union. At runtime this is safe — unknown types will hit the `default` throw in `executeAction()`.

    **6. Update the `runFlow` function body:**

    a. **Replace the `ctx` variable** (line 76):
       Change from: `const ctx: ExecutorContext = { orgId: input.orgId, supabase: input.supabase, state }`
       Change to:   `const flowCtx: FlowExecutorContext = { orgId: input.orgId, supabase: input.supabase, state }`

    b. **Replace the `executeNode` call** (lines 103-110):
       Change from:
       ```typescript
       try {
         const result = await executeNode(node, resolvedConfig, ctx)
         output = result.output
       } catch (err) {
         stepError = err instanceof Error ? err.message : String(err)
       }
       ```
       Change to:
       ```typescript
       try {
         output = await executeFlowNode(node, resolvedConfig, flowCtx)
       } catch (err) {
         stepError = err instanceof Error ? err.message : String(err)
       }
       ```
       (Note: `executeFlowNode` returns `Record<string, unknown>` directly, not `{output: ...}` — no need to destructure.)

    c. All other code in `runFlow` (parsing, loop, step recording, edge walking, finalization, notification) stays **exactly as-is**.

    **7. Important notes while implementing:**
    - The `import type { FlowNodeData }` may need to be added if not already re-exported. Check the schema.ts exports — `FlowNodeData` is exported as a type, so `import type { FlowNodeData } from './schema'` should work. If `FlowNodeData` is not exported, add the type export to schema.ts.
    - The `Database` type is already imported from `@/types/database` (line 9). The `ActionType` enum is `Database['public']['Enums']['action_type']`.
    - `FlowNodeData` is already defined in schema.ts as a Zod discriminated union; ensure the `import type { FlowNodeData } from './schema'` is added.
    - Do NOT add any action-type-specific if/else for shared action types (create_contact, pipeline_*, etc.) — those MUST go through the executeAction() default path.
    - Do NOT import anything from `./executors` after refactoring. The old import must be removed.
    - Preserve all existing comments and documentation in the file.
    - The file will be ~450-500 lines after refactoring (moved executors add ~300 lines).
  </action>
  <verify>
    Check these specific behaviors:
    - `grep -c "import.*executeNode.*executors" src/lib/flows/engine.ts` returns 0 (old import removed)
    - `grep -c "import.*executeAction" src/lib/flows/engine.ts` returns 1 (new import added)
    - `grep -c "executeHttpRequest" src/lib/flows/engine.ts` returns > 0 (http_request moved inline)
    - `grep -c "executeBookingConfirm" src/lib/flows/engine.ts` returns > 0 (booking_confirm moved inline)
    - `npx vitest run` passes (existing test suite)
    - `npm run build` compiles without TypeScript errors
  </verify>
  <done>
    engine.ts no longer imports from executors.ts. Flow-internal executors (http_request, log, booking_*) are inline. All other action types delegate to executeAction(). Tests pass. Build compiles.
  </done>
</task>

<task type="auto">
  <name>Task 2: Delete executors.ts and final verification</name>
  <files>
    src/lib/flows/executors.ts
  </files>
  <action>
    1. **Confirm no remaining imports** of `executors.ts`:
       - Run `grep -r "from.*['\"]\./executors['\"]" src/` to confirm only engine.ts imports it (and it was already removed in Task 1)
       - If any other file imports from `./executors` or `../flows/executors`, update those imports before deletion

    2. **Delete `src/lib/flows/executors.ts`:**
       - Remove the file entirely

    3. **Run full verification suite:**
       - `npx vitest run` — confirm all existing tests pass
       - `npm run build` — confirm TypeScript compiles with no errors
       - Check specifically that `action-engine.test.ts` still passes (the Vapi route mock of `executeAction` must be unaffected)

    4. **If tests fail**, inspect the failure:
       - If a test imports from `executors.ts`, update that test
       - If a type is missing, ensure all necessary types are exported from schema.ts or engine.ts
       - If the build fails, fix TypeScript errors

    5. **Final smoke check on the action types:**
       Confirm that all 20+ shared action types from `src/types/database.ts` line 418 have a path through `executeAction()`:
       - `create_contact`, `get_availability`, `create_appointment`, `send_sms`, `knowledge_base`, `custom_webhook`
       - `manychat_set_field`, `manychat_add_tag`, `manychat_trigger_flow`, `manychat_send_message`
       - `google_contacts_create`, `google_contacts_update`, `google_contacts_find`, `google_contacts_delete`
       - `send_whatsapp_message`, `send_whatsapp_mention_all`, `send_telegram_notification`
       - `pipeline_move_opportunity`, `pipeline_update_opportunity`, `pipeline_mark_won`, `pipeline_mark_lost`, `pipeline_add_note`, `pipeline_assign_user`, `pipeline_create_opportunity`
       - `create_task`, `create_note`
       
       These are all handled by `executeAction()` via the `default` case in `executeFlowNode`. The only action types handled inline in engine.ts are:
       - `http_request`, `log` (flow-utility)
       - `booking_confirm`, `booking_cancel`, `booking_reschedule`, `booking_mark_no_show`, `booking_mark_complete`, `booking_create`, `booking_get` (flow-specific booking operations)
  </action>
  <verify>
    <automated>npx vitest run</automated>
  </verify>
  <done>
    executors.ts deleted. npx vitest passes. npm run build compiles. No imports reference executors.ts.
  </done>
</task>

</tasks>

<verification>
All verification must pass before marking the plan complete:

1. **TypeScript compilation**: `npm run build` exits 0
2. **Existing test suite**: `npx vitest run` — all tests pass (especially `action-engine.test.ts` which mocks `executeAction`)
3. **No orphan imports**: `grep -r "executors" src/` returns only unrelated executors in `src/lib/action-engine/executors/` (those are different files, not `src/lib/flows/executors.ts`)
4. **Action type coverage**: The `default` branch in `executeFlowNode` receives all shared action types — `grep -c "case 'booking_"` shows booking_* handled inline, and all other types fall through to `executeAction()`
5. **No action-type-specific switch for shared types**: The flow engine has no `case 'create_contact'`, `case 'pipeline_'`, etc. — only flow-internal types are in the switch
</verification>

<success_criteria>
1. ✅ `engine.ts` delegates to `executeAction()` for all shared action types — no action-specific switch/if-else in the flow engine for shared types (ENG-01)
2. ✅ All 20+ action types route through `executeAction()` from the flow engine — stubs eliminated (ENG-02)
3. ✅ `executors.ts` deleted — no broken imports anywhere (ENG-03)
4. ✅ Flow-internal executors (`booking_*`) moved inline in `engine.ts` with clear documentation comments (per ROADMAP criterion #4)
5. ✅ `http_request` and `log` executors are inline in `engine.ts` as flow-internal utilities
6. ✅ `npx vitest run` passes — no regressions in action engine or other test suites
7. ✅ `npm run build` compiles — no TypeScript errors
</success_criteria>

<output>
After completion, create `.planning/phases/105-engine-unification/105-01-SUMMARY.md` summarizing:
- What changed in engine.ts (imports removed, imports added, inline executors, executeAction delegation)
- That executors.ts was deleted
- Verification results (build + test suite)
- Action type coverage matrix
</output>
