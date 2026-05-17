---
phase: 61
plan: 01
status: complete
completed: 2026-05-17
---

# Plan 61-01 Summary

## What landed

- `src/components/integrations/integrations-table.tsx`:
  - Removed `{ id: 'twilio', ... }` from `ALL_PROVIDERS`
  - Added a comment block above the const documenting the routing rule
- `src/app/(dashboard)/integrations/page.tsx`:
  - `DedicatedIntegration.meta?: string` added to the type
  - `DedicatedCard` renders `meta` as a `text-[11.5px] text-text-tertiary` sub-line beneath the description
  - Computes `activeTwilioNumberCount` via `listTwilioNumbers()` (dynamic import to keep server bundle tight)
  - Twilio `connected` flag now requires both credentials AND ≥1 active number
  - Twilio card description rewritten: "Register multiple Twilio numbers per org and pick a default for outbound."
  - `twilioMeta` shows "X numbers configured" / "1 number configured" / "Credentials saved · 0 numbers"

## Verification

- `npx tsc --noEmit` clean (excluding pre-existing chat-layout)
- API-key table now has 6 providers (Vapi, GoHighLevel, Cal.com, OpenAI, Anthropic, OpenRouter)
- Twilio appears exactly once — as the dedicated card
