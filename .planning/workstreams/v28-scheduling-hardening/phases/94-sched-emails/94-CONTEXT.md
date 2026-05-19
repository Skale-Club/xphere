---
phase: 94
slug: sched-emails
type: infrastructure
---

# Phase 94 Context — SCHED-EMAILS

## Goal

Notify bookers by email when their booking is confirmed and when it is cancelled. Use Resend as the provider. Email delivery must be fire-and-forget — booking success cannot depend on it.

## Why now

Today, after `createBooking` succeeds, the user is shown a "Booking confirmed!" panel and "A calendar invite will be sent to your email." But no email is actually sent — the calendar invite only fires when Google Calendar is connected (which it usually isn't for the booker). This violates trust.

## Provider Decision

Resend was not in `package.json` at the start of this phase. Installed via `npm install resend` (v6.12.3). If `RESEND_API_KEY` is not set in the environment, the email helper logs a warning and no-ops — booking continues normally.

## Inputs

- `src/app/(dashboard)/scheduling/_actions/bookings.ts` — `createBooking`, `cancelBookingByToken`, `cancelBooking`
- `supabase/migrations/071_scheduling.sql` — `event_types`, `scheduling_profiles`, `bookings` schemas
- `process.env.NEXT_PUBLIC_SITE_URL` — base URL for cancel/rebook links (default `https://xphere.skale.club`)

## Constraints

- Never throw from the email helper — fire-and-forget on all paths
- Templates inline (no external template engine) — dark theme to match Xphere brand
- The host name comes from `auth.users.email` (we don't have a profile name table for scheduling)

## Plans

- 94-01: Resend client + sendBookingConfirmation
- 94-02: sendBookingCancellation + wire into all 3 action handlers
