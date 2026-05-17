# Phase 59: NUMBERS-ACTIONS - Context

**Gathered:** 2026-05-17
**Status:** Ready for planning
**Mode:** Infrastructure phase — decisions locked from pre-planning conversation + Phase 58 outcomes

<domain>
## Phase Boundary

Wire the new `twilio_phone_numbers` table into every Twilio code path that previously used `integrations.config.from_number`, while keeping the legacy field as a read-fallback this release (per locked roadmap decision).

What this phase delivers:
- `src/app/(dashboard)/integrations/twilio/numbers-actions.ts` — CRUD server actions with Zod validation
- Refactor of `src/lib/twilio/voice.ts` — `resolveTwilioOrgByToNumber` queries the new table first, falls back to `config.from_number`; `resolveTwilioCredentialsForOrg` accepts optional `phoneNumberId`
- Refactor of `src/lib/twilio/send-sms.ts` — `resolveTwilioCredentials` accepts optional `fromNumberId`; defaults to org's default number; clear error if no default exists
- Update to `src/app/(dashboard)/integrations/twilio/actions.ts`:
  - `TwilioIntegrationView.numbers: TwilioPhoneNumberRow[]`
  - `smsConfigured = hasAccountSid && hasAuthToken && numbers.some(active+SMS)`
  - `testSendSms({to, fromNumberId?})`
  - `saveTwilioIntegration` stops accepting `fromNumber` (Phase 60 UI calls `numbers-actions` instead)

What this phase does NOT deliver:
- The new UI (lives, dialog) → Phase 60
- Removing `config.from_number` → next milestone (legacy fallback stays)
- Changes to GHL reengagement runner (`src/lib/automations/ghl-reengagement/runner.ts`) — its `fromNumberOverride` is routed THROUGH GHL's API, not directly to Twilio; the existing path is unaffected

</domain>

<decisions>
## Implementation Decisions

### `numbers-actions.ts` shape (locked)

Exports (all server actions, all RLS-scoped via `createClient()`):

```ts
listTwilioNumbers(): Promise<TwilioPhoneNumberRow[]>
createTwilioNumber(input: CreateNumberInput): Promise<{ data?: TwilioPhoneNumberRow; error?: string }>
updateTwilioNumber(id: string, input: UpdateNumberInput): Promise<{ data?: TwilioPhoneNumberRow; error?: string }>
softDeleteTwilioNumber(id: string): Promise<{ error?: string }>
setDefaultTwilioNumber(id: string): Promise<{ error?: string }>
```

### Zod schemas (locked)

```ts
const e164Regex = /^\+[1-9]\d{6,14}$/
const phoneSidRegex = /^PN[a-f0-9]{32}$/i

const CreateNumberSchema = z.object({
  e164: z.string().regex(e164Regex, 'Invalid E.164 format'),
  phone_sid: z.string().regex(phoneSidRegex).optional().or(z.literal('')),
  friendly_name: z.string().min(1, 'Friendly name required').max(64),
  capability_sms: z.boolean().default(false),
  capability_mms: z.boolean().default(false),
  capability_voice: z.boolean().default(false),
  default_routing_mode: z.enum(['browser', 'sip', 'forward']).nullable().optional(),
  forward_to_number: z.string().regex(e164Regex).optional().or(z.literal('')),
  is_default: z.boolean().default(false),
  notes: z.string().max(500).optional(),
}).superRefine((data, ctx) => {
  if (!data.capability_sms && !data.capability_mms && !data.capability_voice) {
    ctx.addIssue({ code: 'custom', message: 'At least one capability must be enabled', path: ['capability_sms'] })
  }
  if (data.default_routing_mode === 'forward' && !data.forward_to_number) {
    ctx.addIssue({ code: 'custom', message: 'forward_to_number is required when routing mode is "forward"', path: ['forward_to_number'] })
  }
})
```

`UpdateNumberSchema` = same shape with all fields optional (partial). `superRefine` runs only when relevant fields are present.

### Default toggle atomicity (locked)

`createTwilioNumber` and `updateTwilioNumber` handle `is_default=true` via a two-step write inside a single RPC-style flow:

1. `UPDATE twilio_phone_numbers SET is_default=false WHERE organization_id=? AND is_default=true`
2. Then perform the INSERT or UPDATE with `is_default=true`

The DB partial unique index `twilio_phone_numbers_one_default_per_org` is the safety net — if a race happens, the second writer fails cleanly and the action surfaces a clear error.

### Voice library refactor (locked)

`src/lib/twilio/voice.ts`:

- `resolveTwilioCredentialsForOrg(orgId, options?: { phoneNumberId?: string })`:
  - If `options.phoneNumberId` is passed, look up that specific number; if not, look up the org's default
  - If no default exists, falls back to `config.from_number` for backwards compat (Phase 58 backfill guarantees no current org lands here, but the fallback is the legacy safety net)
  - Returns `TwilioVoiceCredentials | null` with the resolved `fromNumber`

- `resolveTwilioOrgByToNumber(toNumber)`:
  - **First attempt**: `JOIN twilio_phone_numbers tpn ON tpn.organization_id = integrations.organization_id WHERE tpn.e164=? AND tpn.is_active=true`
  - **Fallback**: existing query `WHERE config->>'from_number' = ?`
  - Both attempts return `{ orgId, creds }` shape

### Send-SMS library refactor (locked)

`src/lib/twilio/send-sms.ts::resolveTwilioCredentials(ctx, options?: { fromNumberId?: string })`:

- If `fromNumberId` is provided, look up that specific number (must be active + capability_sms)
- Otherwise, use the org's default number; if no default and no specific id → error `"Twilio integration has no default phone number. Configure one in /integrations/twilio."`
- Falls back to `config.from_number` as legacy safety net (same as voice.ts)

### `actions.ts` updates (locked)

- New helper `getDefaultTwilioNumberForOrg(orgId): Promise<TwilioPhoneNumberRow | null>` — reused by `voice.ts`/`send-sms.ts` and the integration view
- `TwilioIntegrationView` adds `numbers: TwilioPhoneNumberRow[]`
- `smsConfigured` recomputed: `hasAccountSid && hasAuthToken && numbers.some(n => n.is_active && n.capability_sms)`
- `voiceConfigured` recomputed: `hasAccountSid && hasApiKeySid && hasApiKeySecret && Boolean(twimlAppSid) && numbers.some(n => n.is_active && n.capability_voice)` — adds voice capability requirement
- `saveTwilioIntegration` removes `fromNumber` from input (UI uses `numbers-actions.ts` after Phase 60 lands)
  - Keep `fromNumber?` optional in the type but ignore it on write — gentle deprecation; remove next milestone
- `testSendSms` adds `fromNumberId?: string` — uses default if omitted; passes the resolved E.164 as the `From`

### Compat strategy (locked)

The legacy `config.from_number` is read but never written by this phase. Until next milestone:
- `saveTwilioIntegration` ignores `fromNumber` in inputs
- The migration's backfill (Phase 58) covered existing rows
- New numbers go via `numbers-actions.ts` only

### Claude's Discretion

- Exact error message text — keep human-readable, action-oriented
- Whether `softDeleteTwilioNumber` revalidates extra paths (e.g., `/settings/calls`) — recommend yes
- Whether `setDefaultTwilioNumber` is its own action or rolled into `updateTwilioNumber({is_default: true})` — recommend keep it separate for clarity (single-purpose CRUD verb)

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets

- `createClient` and `createServiceRoleClient` patterns from `@/lib/supabase` — already used throughout Twilio code
- `revalidatePath` for `/integrations`, `/integrations/twilio`, `/settings/calls` — pattern from `saveTwilioIntegration`
- Zod schemas pattern from existing server actions (e.g., chat conversations, agents)
- Twilio Phone Number SID regex: `^PN[a-f0-9]{32}$` (32 hex chars after PN prefix)

### Established Patterns

- Server actions return `{ data?, error? }` or `{ success, error? }` (the latter for test/mutation flows) — match the existing `actions.ts` patterns
- `'use server'` directive at the top, all actions are exported async functions
- Auth check: `const user = await getUser(); if (!user) return { error: 'Not authenticated.' }`
- Org check: `const { data: orgId } = await supabase.rpc('get_current_org_id'); if (!orgId) return { error: 'No active organization.' }`
- DB writes go through the authenticated client (`createClient`) — RLS handles tenant isolation; never manually filter by `organization_id` in inserts (let RLS WITH CHECK do it)

### Integration Points

- `src/lib/twilio/voice.ts:77` (`resolveTwilioOrgByToNumber`) — webhook hot path
- `src/lib/twilio/send-sms.ts:21` (`resolveTwilioCredentials`) — action-engine hot path
- `src/app/(dashboard)/integrations/twilio/actions.ts:69` (`getTwilioIntegration`) — UI data source for Phase 60
- `src/app/api/twilio/voice/route.ts:131` (uses `resolveTwilioCredentialsForOrg`)
- The GHL reengagement runner is NOT a direct Twilio path — its `fromNumberOverride` goes through GHL's API; no change needed

</code_context>

<specifics>
## Specific Ideas

- Surface a clear inline error when an org has zero numbers but tries to test SMS — the message should suggest "Configure a default phone number first"
- Keep `from_number` as legacy fallback at exactly two read points: `resolveTwilioOrgByToNumber` (voice.ts) and `resolveTwilioCredentials` (send-sms.ts). All other paths read from `twilio_phone_numbers` directly.
- The new `numbers` field in `TwilioIntegrationView` is fetched in the same `getTwilioIntegration` call (1 extra SELECT) — does NOT need to be a separate roundtrip
- Type the `TwilioPhoneNumberRow` once in `actions.ts` and re-export from `numbers-actions.ts` to keep the symbol single-sourced

</specifics>

<deferred>
## Deferred Ideas

- Removing `config.from_number` writes and reads → next milestone
- Bulk-import numbers from Twilio's API → not in scope (operators register manually)
- Per-number webhook URL display in the UI → Phase 60 / not deferred but separate concern
- Renaming `resolveTwilioCredentials` to clarify "default vs specific" semantic — keep the name; the optional param makes the semantics clear

</deferred>
