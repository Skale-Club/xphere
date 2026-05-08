---
phase: 31-tool-config-form-ui
plan: 01
subsystem: ui
tags: [react-hook-form, zod, tool-config, custom_webhook, send_sms, form-validation]

# Dependency graph
requires:
  - phase: 30-executor-backends
    provides: send_sms and custom_webhook executor implementations wired into action engine
provides:
  - Conditional config fields in tool-config-form for send_sms (Twilio hint) and custom_webhook (URL/method/headers/body)
  - Fix for integration_id NOT NULL Postgres rejection when saving custom_webhook tool configs
  - superRefine validation: integrationId required for non-webhook action types; url required for custom_webhook
affects: [tools-page, tool-config-form, actions-server]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "superRefine conditional validation pattern in zod — action-type-dependent field requirements in a single schema"
    - "Conditional spread pattern for nullable FK columns — ...(value && value.length > 0 ? { col: value } : {})"

key-files:
  created: []
  modified:
    - src/components/tools/tool-config-form.tsx
    - src/app/(dashboard)/tools/actions.ts

key-decisions:
  - "integrationId made optional/nullable in zod schema with conditional required check via superRefine rather than conditional schema swapping — keeps the type simple"
  - "config fields only passed in onSubmit payload when actionType is custom_webhook to avoid polluting config JSONB for other action types"

patterns-established:
  - "Conditional FK spread: use ...(id && id.length > 0 ? { col: id } : {}) for NOT NULL UUID columns that are legitimately absent for some action types"
  - "Form field gating with watchedActionType: watch the discriminator field and conditionally render entire FormField blocks"

requirements-completed: [SMS-05, WEBHOOK-06]

# Metrics
duration: 12min
completed: 2026-05-07
---

# Phase 31 Plan 01: Tool Config Form UI Summary

**Conditional form fields for send_sms (Twilio hint) and custom_webhook (URL/method/headers/body), plus fix for integration_id NOT NULL Postgres rejection on custom_webhook saves.**

## Performance

- **Duration:** 12 min
- **Started:** 2026-05-07T00:01:31Z
- **Completed:** 2026-05-07T00:13:00Z
- **Tasks:** 1/1
- **Files modified:** 2

## Accomplishments

- Fixed a data-integrity bug: `createToolConfig` and `updateToolConfig` no longer write an empty string to the `integration_id` NOT NULL UUID column when saving `custom_webhook` tool configs — conditional spread omits the column entirely when `integrationId` is empty
- Extended the zod schema with a `config` sub-object (url/method/headers/body as optional strings) and replaced the hard-coded `uuid()` validation on `integrationId` with a `superRefine` check that only requires it for action types other than `custom_webhook`
- Admin can now configure `custom_webhook` tools entirely from the UI: Webhook URL (required), HTTP Method (GET/POST/PUT/PATCH select defaulting to POST), Headers JSON (optional textarea), Body Template with `{{param_name}}` placeholder hint (optional textarea)
- Admin sees a Twilio integration hint description when `send_sms` is selected
- Edit mode pre-populates all 4 config fields from the stored `tool_configs.config` JSONB

## Task Commits

1. **Task 1: Fix integration_id save path and add conditional config fields** - `f3cc537` (feat)

**Plan metadata:** committed with SUMMARY.md update

## Files Created/Modified

- `src/components/tools/tool-config-form.tsx` — Updated zod schema with superRefine, watchedActionType watch, config defaultValues for edit mode, conditional Integration field rendering, conditional custom_webhook field block (4 fields), updated onSubmit payload
- `src/app/(dashboard)/tools/actions.ts` — Fixed `createToolConfig` and `updateToolConfig` to use conditional spread for `integration_id`

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None — all 4 config fields are wired to the zod schema and onSubmit payload; data flows to the `tool_configs.config` JSONB column.

## Self-Check: PASSED

- `src/components/tools/tool-config-form.tsx` — exists and contains `config.url`, `config.method`, `watchedActionType`, `superRefine`
- `src/app/(dashboard)/tools/actions.ts` — exists and contains `integrationId &&` in both createToolConfig and updateToolConfig
- `f3cc537` — commit exists in git log
- `npm run build` — exited 0, no TypeScript errors
