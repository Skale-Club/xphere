# Phase 27: OAuth + DB Foundation - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-06
**Phase:** 27-oauth-db-foundation
**Areas discussed:** Google OAuth credentials source

---

## Google OAuth App Credentials

| Option | Description | Selected |
|--------|-------------|----------|
| Env vars | `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` — consistent with Meta pattern | ✓ |
| Platform settings | Store in DB via admin panel — better long-term, requires more setup now | |

**User's choice:** Env vars for now, move to platform_settings in a future milestone.
**Notes:** User acknowledged the TODO to migrate Meta credentials to platform_settings too. Chose pragmatic path — ship first, refactor later.

---

## Claude's Discretion

- Token payload JSON structure within `encrypted_api_key`
- Error redirect paths
- File naming and module structure for `src/lib/google-contacts/`

## Deferred Ideas

- Platform settings migration for Google OAuth credentials — future milestone
