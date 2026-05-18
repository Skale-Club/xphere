# Deferred Items — Phase 64 ACCOUNTS-SCHEMA

Items discovered during plan execution that are **out of scope** for the current plan and intentionally NOT fixed here.

## Pre-existing `npm run build` failures (out of scope, unrelated to Phase 64)

Discovered during Plan 64-01 verification. `npm run build` fails with 13 module-not-found errors against missing npm packages introduced by earlier commits (v2.1 / v2.3 work, e.g. commit `5580cbb feat(calls): unified Calls hub`):

- `@aws-sdk/client-s3`
- `@radix-ui/react-popover`
- `@twilio/voice-sdk`
- `cmdk`
- `framer-motion`
- `next-themes`
- `react-confetti`
- `react-international-phone`
- `wavesurfer.js`

These dependencies are referenced by files like `src/components/calls/twilio-device-provider.tsx`, `src/components/command-palette.tsx`, `src/components/ui/popover.tsx` — **none touched by Phase 64**. Migration 064 adds DB schema only; it does not import or reference any TS code.

**Decision:** out of scope for Phase 64. The migration applied cleanly to the remote Supabase DB and was validated via direct REST queries (see `64-01-SUMMARY.md` § Verification). The build failure must be resolved by a dedicated `npm install` pass or dependency-restoration plan in a later phase or workstream-level chore.

**Action item for project lead:** run `npm install @aws-sdk/client-s3 @radix-ui/react-popover @twilio/voice-sdk cmdk framer-motion next-themes react-confetti react-international-phone wavesurfer.js` (or restore via lockfile from the commit that last had a clean build).
