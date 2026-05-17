# v2.3 — HUMAN-UAT Checklist

Operator-side smoke tests to run before considering v2.3 fully shipped.
Each item maps back to a verification item that was deferred from an earlier phase.

## Setup (one-time)

- [ ] `npx supabase db push` — applies migration `058_twilio_phone_numbers.sql`
- [ ] Verify the migration succeeded: `select count(*) from twilio_phone_numbers;` returns a non-zero number for each org that had `integrations.config->>'from_number'` set
- [ ] Start the dev server: `npm run dev` (Turbopack on port 4267)

## A. Schema invariants (Phase 58)

- [ ] **Backfill correctness** — for every org that had a `from_number` configured before, there is exactly one row in `twilio_phone_numbers` with `is_default=true` and `capability_sms=true, capability_voice=true, capability_mms=false`
- [ ] **Partial unique index rejects second default** — manually attempt `update twilio_phone_numbers set is_default=true where organization_id='<org>' and id='<other-row>';` (with another row already default) → should error with unique constraint violation
- [ ] **RLS isolation** — open two browser sessions for two different orgs; the numbers list under `/integrations/twilio` shows only that org's numbers

## B. Server actions + lib resolution (Phase 59)

- [ ] **Inbound call (legacy fallback)** — for an org with NO `twilio_phone_numbers` row (only `config.from_number`), receive a real inbound call → `resolveTwilioOrgByToNumber` should still match via the legacy fallback
- [ ] **Inbound call (new path)** — for an org WITH a `twilio_phone_numbers` row whose `e164` matches the inbound `To` → matches via the new table
- [ ] **send_sms default** — Vapi-triggered `send_sms` tool with no `fromNumberId` → resolves to the org's default number
- [ ] **send_sms with explicit id** — fire `send_sms` from a Vapi tool config that includes `fromNumberId` → uses that specific number's E.164
- [ ] **send_sms capability gate** — try to send SMS from a number with `capability_sms=false` → clear error surfaces

## C. UI flow (Phase 60)

- [ ] **Empty state** — for a fresh org, `/integrations/twilio` Phone numbers section shows the EmptyState with "Add your first number" CTA
- [ ] **Create flow** — click Add → fill all fields → save → number appears in the list immediately with correct capability badges + Default pill
- [ ] **Edit flow** — click kebab → Edit → change friendly_name → save → list reflects the new name
- [ ] **Set default** — with multiple numbers, click kebab → "Set as default" on a non-default → prior default loses its pill, new one gains it
- [ ] **Soft delete** — click kebab → Remove → confirm → number disappears from list; verify in SQL it still exists with `is_active=false`
- [ ] **Validation** — try to save with no capabilities checked → inline error toast
- [ ] **Forward mode** — set routing to "Forward to number" → `forward_to_number` field appears → save with empty forward target → toast error

## D. Index page (Phase 61)

- [ ] **API-key table count** — `/integrations` shows 6 rows in the API key providers table (Vapi, GHL, Cal.com, OpenAI, Anthropic, OpenRouter) — NO Twilio row
- [ ] **Twilio card pill** — for an org with credentials but zero active numbers → card shows "Not connected"
- [ ] **Twilio card pill** — for an org with credentials AND at least one active number → card shows "Connected" + sub-line "X numbers configured"
- [ ] **Round-trip refresh** — add a number on `/integrations/twilio`, return to `/integrations` → count updates without manual page reload

## E. Visual unification (Phase 62)

- [ ] **Side-by-side chrome** — open `/integrations/twilio` in one tab, `/integrations/google-reviews` in another → section card chrome (border-radius, padding, header layout, pill placement) is visually identical
- [ ] **Google Reviews golden path** — save SerpAPI key → pick business → see status grid → see recent reviews → copy embed snippet → all flows work
- [ ] **Google Reviews empty state** — for an org not yet configured, the "Almost there" empty state uses the canonical EmptyState primitive (icon-in-circle + halo, not the legacy hand-rolled card)

## F. Build green (Phase 63)

- [ ] **`npm run build`** passes — this requires the parallel chat-pagination work to also have completed. If chat-pagination is still incomplete, build verification carries forward as a separate task outside v2.3
- [ ] `npx vitest run` passes — the 15 new tests in `tests/twilio-numbers-actions.test.ts` are part of the run

## Sign-off

Once all items are checked, mark this file `status: passed` in its frontmatter and v2.3 is ready to ship.
