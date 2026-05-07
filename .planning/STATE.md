---
gsd_state_version: 1.0
milestone: v1.7
milestone_name: Google Contacts Integration
status: planning
stopped_at: "Roadmap created — 3 phases defined (27-29), ready for phase planning"
last_updated: "2026-05-06T00:00:00.000Z"
last_activity: 2026-05-06
progress:
  total_phases: 3
  completed_phases: 0
  total_plans: 0
  completed_plans: 0
---

# Operator - State

## Current Position

Phase: Not started (roadmap defined, awaiting plan-phase)
Plan: —
Status: Roadmap created
Last activity: 2026-05-06

## Milestone Progress

- v1.0 MVP: ✅ Shipped 2026-04-03
- v1.1 Knowledge Base: ✅ Shipped 2026-04-03
- v1.2 Operator + Embedded Chatbot: ✅ Shipped 2026-04-05
- v1.3 Google Reviews Widget + Meta Messaging: ✅ Shipped 2026-05-05
- v1.4 Chat System Refactor: ✅ Shipped 2026-05-05
- v1.5 Tools Folder System: ✅ Shipped 2026-05-06
- v1.6 ManyChat Integration: 🚧 Active — Phases 22-24 complete, Phases 25-26 pending

## v1.7 Phase Summary

| Phase | Goal | Status |
|-------|------|--------|
| 27. OAuth + DB Foundation | Google OAuth per org; encrypted token storage in integrations table | Not started |
| 28. Action Executors | 4 google_contacts_* action types dispatching to Google People API | Not started |
| 29. Dashboard UI | Connect/disconnect card + connection status on /integrations | Not started |

## Project Reference

See `.planning/PROJECT.md` for vision, validated requirements, decisions.
See `.planning/MILESTONES.md` for shipped history.
See `.planning/REQUIREMENTS.md` for v1.7 requirement traceability.

**Core value:** The Action Engine must work reliably for every tenant
**App name:** Operator
**Production origin:** https://operator.skale.club

## Accumulated Context

### v1.7 Architecture Decisions

- Google OAuth follows the Meta OAuth reference implementation pattern (src/lib/meta/oauth.ts, src/app/api/meta/callback/route.ts)
- Tokens stored in existing `integrations` table — requires adding `google_contacts` value to `integration_provider` enum
- `encrypted_credentials` JSON column stores `{ access_token, refresh_token, token_expiry, google_email }` encrypted via AES-256-GCM (src/lib/crypto.ts)
- OAuth callback resolves org_id from the authenticated session — same pattern as Meta OAuth
- Action executors in src/lib/action-engine/ — new file per action type or grouped google-contacts module
- Executors must handle token refresh transparently (access token expiry) before calling People API
- All 4 action types use standard field mapping: name, email, phone, company, notes
- google_contacts_find returns structured contact data in the action result for downstream use in AI responses
- One Google account per org (UNIQUE(org_id, provider) already enforced by integrations table)

### Architecture Notes (v1.7)

- Enum extension: `integration_provider` += google_contacts
- No new tables required — uses existing `integrations` table for credential storage
- New files: `src/lib/google-contacts/` client module + token refresh logic
- New route: `src/app/api/google/callback/route.ts` for OAuth callback
- Action engine dispatch: 4 new cases in the executor switch — google_contacts_create, google_contacts_update, google_contacts_find, google_contacts_delete
- People API scope required: `https://www.googleapis.com/auth/contacts`
- OAuth initiation route: `src/app/api/google/oauth/route.ts` (redirects to Google consent)

## Pending Todos

- Run `npx supabase db push` when SUPABASE_DB_PASSWORD is available (migrations pending)
- Register Google OAuth app in Google Cloud Console (Client ID + Secret needed as platform_settings)

## Session Continuity

Last session: 2026-05-06T00:00:00.000Z
Stopped at: Roadmap created — next step is /gsd:plan-phase 27
