# Roadmap: Operator

## Overview

Operator is a multi-tenant agency operations platform built around a reliable Action Engine. The v1.9 milestone adds the first scheduled automation on top of the existing executor surface: a daily job that finds GoHighLevel "Lost" opportunities older than a configurable threshold (default 180 days) for the Skleanings sub-account and dispatches a Twilio SMS reengagement message, with persistent anti-loop tracking. This milestone is an intentionally lean MVP — hardcoded to one client via env vars, no UI, no retry, no multi-channel. It reuses the Twilio executor shipped in v1.8 and the GHL client groundwork from v1.0, adding only the missing pieces: a new GHL list method, an anti-loop table, a protected runner endpoint, and a scheduled GitHub Action.

## Milestones

- ✅ **v1.0 MVP** - Phases 1-6 (shipped 2026-04-03)
- ✅ **v1.1 Knowledge Base** - Phase 7 (shipped 2026-04-03)
- ✅ **v1.2 Operator + Embedded Chatbot** - Phases 8-13 (shipped 2026-04-05)
- ✅ **v1.3 Google Reviews Widget + Meta Messaging** - Phases 14-20 (shipped 2026-05-05)
- ✅ **v1.4 Chat System Refactor** - Phases 21-25 (shipped 2026-05-05)
- ✅ **v1.5 Tools Folder System** - Phase 26 (shipped 2026-05-06)
- ✅ **v1.6 ManyChat Integration** - Phases 27-28 (shipped 2026-05-07)
- ✅ **v1.7 Google Contacts Integration** - Phase 29 (shipped 2026-05-07)
- ✅ **v1.8 Executor Completeness** - Phases 30-31 (shipped 2026-05-08)
- 🚧 **v1.9 GHL Lost-Lead Reengagement (SMS)** - Phase 32 (in progress)

Archived roadmaps: `.planning/milestones/v1.{0..8}-ROADMAP.md`.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (32.1, 32.2): Urgent insertions (marked with INSERTED)

Continuous numbering across milestones. v1.8 ended at phase 31; v1.9 starts at phase 32.

- [x] **Phase 32: GHL Lost-Lead Reengagement SMS Automation** - End-to-end scheduled MVP: GHL list + anti-loop migration + runner endpoint + daily GitHub Action + docs (completed 2026-05-16)

## Phase Details

### Phase 32: GHL Lost-Lead Reengagement SMS Automation
**Goal**: A daily scheduled job identifies GoHighLevel "Lost" opportunities older than the configured threshold for the Skleanings sub-account, sends a Twilio SMS reengagement message to each contact (with `{{first_name}}` substitution and STOP opt-out compliance), persists an anti-loop record so the same contact is never re-messaged, and logs every dispatch in `action_logs` for observability — all configured exclusively via env vars and triggered by a GitHub Action workflow (with manual `workflow_dispatch` available).
**Depends on**: Phase 31 (v1.8 `send_sms` Twilio executor)
**Requirements**: REENG-01, REENG-02, REENG-03, REENG-04, REENG-05, REENG-06, REENG-07, REENG-08, REENG-09, REENG-10, REENG-11, REENG-12, REENG-13, REENG-14, REENG-15, REENG-16, REENG-17
**Success Criteria** (what must be TRUE):
  1. A GitHub Action runs daily at the scheduled time (cron `0 14 * * *`) and successfully calls the runner endpoint with the bearer secret; the same workflow can be triggered manually from the GitHub UI via `workflow_dispatch`
  2. Calling `POST /api/automations/ghl-reengagement/run` with the correct bearer secret returns a JSON summary `{ processed, sent, skipped, failed, errors[] }` reflecting the actual pass; calling it without the secret returns HTTP 401
  3. Every Lost opportunity in the configured GHL location whose `updatedAt` is older than the threshold (default 180 days) receives exactly one SMS per contact ever — repeated invocations skip contacts already present in `ghl_reengagement_sent`
  4. Each SMS message has `{{first_name}}` substituted (or the fallback "amigo(a)" when missing) and every dispatch attempt (success or failure) appears in `action_logs` with `tool_name='ghl_reengagement_sms'` and either response payload or error detail
  5. An operator can configure the automation end-to-end by setting env vars on Vercel + GitHub Action secrets — the required vars are documented in `docs/automations/ghl-reengagement.md` along with the cron schedule and how to manually trigger a run
**Plans**: 4 plans
- [x] 32-01-PLAN.md — Wave 0 test scaffolds (4 Vitest stubs + shared fixture for REENG-01, 03, 08)
- [x] 32-02-PLAN.md — GHL list lib + render-template helper + migration 032_ghl_reengagement_sent + schema push + types regen (REENG-01..04, 08, 09)
- [x] 32-03-PLAN.md — runReengagement orchestration (claim-first anti-loop, allSettled dispatch, logAction redaction) (REENG-02, 04, 10, 11, 12)
- [x] 32-04-PLAN.md — Protected route handler + GitHub Action workflow + operator docs + phase gate (REENG-05..07, 13..17)

## Progress

**Execution Order:**
Phases execute in numeric order: 32 → (future phases continue from 33)

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 32. GHL Lost-Lead Reengagement SMS Automation | v1.9 | 4/4 | Complete    | 2026-05-16 |
