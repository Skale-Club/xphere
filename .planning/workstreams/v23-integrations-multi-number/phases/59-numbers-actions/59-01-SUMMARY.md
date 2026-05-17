---
phase: 59
plan: 01
title: numbers-actions.ts + voice.ts/send-sms.ts/actions.ts refactor
status: complete
completed: 2026-05-17
---

# Plan 59-01 Summary

## What landed

### New file
- `src/app/(dashboard)/integrations/twilio/numbers-actions.ts` (~280 LOC)
  - 5 server actions: `listTwilioNumbers`, `createTwilioNumber`, `updateTwilioNumber`, `softDeleteTwilioNumber`, `setDefaultTwilioNumber`
  - Zod schemas: `CreateNumberSchema`, `UpdateNumberSchema` with superRefine for "at least one capability" + "forward requires forward_to_number" rules
  - Default-toggle pattern: clear prior defaults via RLS-scoped `UPDATE` then `INSERT`/`UPDATE` the target — DB partial unique index is the race safety net
  - Soft delete via `is_active=false` (also clears `is_default=false` so the org is prompted to pick a new default)

### Refactored files
- `src/lib/twilio/voice.ts`:
  - `resolveTwilioCredentialsForOrg(orgId, options?: { phoneNumberId? })` — resolves From via specific id > org default > legacy `config.from_number`
  - `resolveTwilioOrgByToNumber(toNumber)` — first queries `twilio_phone_numbers.e164` joined to integrations, falls back to legacy `config->>from_number`
- `src/lib/twilio/send-sms.ts`:
  - `resolveTwilioCredentials(ctx, options?: { fromNumberId? })` — same resolution order; validates `capability_sms`; clear error messages
  - `sendSms` accepts optional `params.fromNumberId`
- `src/app/(dashboard)/integrations/twilio/actions.ts`:
  - `TwilioIntegrationView.numbers: TwilioPhoneNumberRow[]` added (fetched in parallel with the integrations row)
  - `smsConfigured = hasAccountSid && hasAuthToken && numbers.some(n => n.is_active && n.capability_sms)` — replaces the `fromNumber` boolean
  - `voiceConfigured` now also requires at least one `is_active && capability_voice` number
  - `saveTwilioIntegration` deprecates the `fromNumber` input (kept in type for backwards compat, no longer written)
  - `testSendSms({to, fromNumberId?})` — resolves From via the new path; legacy fallback to `config.from_number` preserved

## Verification

- `npx tsc --noEmit` filtered to non-chat files returns **zero** errors. The pre-existing `chat-layout.tsx` breakage is unrelated.
- All call sites of `resolveTwilioCredentials*` continue to compile — the new optional `options` parameter is backwards compatible.
- `revalidatePath` calls cover the three relevant routes (`/integrations`, `/integrations/twilio`, `/settings/calls`) so the upcoming Phase 60 UI gets fresh data after mutations.
- GHL reengagement runner (`src/lib/automations/ghl-reengagement/runner.ts`) intentionally NOT changed — its `fromNumberOverride` is forwarded through GHL's API, not direct Twilio.

## Tasks completed

- [x] Created `numbers-actions.ts` with 5 CRUD actions + Zod
- [x] Refactored `voice.ts` (both resolution functions)
- [x] Refactored `send-sms.ts` (`resolveTwilioCredentials` + `sendSms`)
- [x] Updated `actions.ts` (`TwilioIntegrationView.numbers`, capability-aware `smsConfigured`/`voiceConfigured`, `saveTwilioIntegration` stops writing `from_number`, `testSendSms` accepts `fromNumberId`)
- [x] Type check clean (excluding pre-existing chat-layout breakage)

## Out of scope (next phases)

- UI for managing numbers → Phase 60
- Visual unification of dedicated pages → Phase 62
- Tests for the new server actions → Phase 63 (Vitest)
