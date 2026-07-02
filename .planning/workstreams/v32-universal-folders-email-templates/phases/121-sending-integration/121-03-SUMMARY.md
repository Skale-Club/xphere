---
phase: 121-sending-integration
plan: 03
subsystem: campaigns
tags: [campaigns, email, email-templates, wizard]
requires:
  - email_templates (status='published') (Phase 117/120)
  - campaigns.template_config JSONB (pre-existing column)
provides:
  - listCampaignEmailTemplates server action
  - email campaign builder-template selection persisted as { email_template_id }
affects:
  - "src/app/(dashboard)/campaigns/actions.ts (createCampaign email path)"
  - "src/app/(dashboard)/campaigns/_components/new-campaign-wizard.tsx (email step)"
tech-stack:
  added: []
  patterns:
    - "Store channel-specific content in the existing campaigns.template_config JSONB (no schema change)"
    - "Wizard lazy-loads step-4 channel data in a [step, channel] useEffect (mirrors whatsapp/vapi loaders)"
key-files:
  created: []
  modified:
    - src/app/(dashboard)/campaigns/actions.ts
    - src/app/(dashboard)/campaigns/_components/new-campaign-wizard.tsx
decisions:
  - "No migration: email campaigns store { email_template_id } in the SAME campaigns.template_config JSONB that SMS uses for { sms_body } — the column already exists."
  - "createCampaign validates the selected template is org-scoped (RLS) and status='published' before persisting, mirroring the whatsapp APPROVED-template guard."
metrics:
  duration: ~3m
  tasks: 2
  files: 2
  completed: 2026-07-02
---

# Phase 121 Plan 03: Campaign Builder-Template Selection Summary

Configuring an email campaign now lets the user pick a published builder email template (replacing the "coming soon" stub); the selection persists on the existing `campaigns.template_config` JSONB as `{ email_template_id }` with no schema change or migration.

## What Was Built

### Task 1 — action layer (commit `699e4480`)
- `CreateCampaignInput` gained optional `email_template_id?: string | null` (UFE-12).
- `createCampaign` `templateConfig` build extended: an email campaign with an `email_template_id` writes `{ email_template_id }` into the same `template_config` JSONB SMS uses for `{ sms_body }`.
- Added an email validation guard (alongside the whatsapp APPROVED guard): requires `email_template_id`, loads the `email_templates` row (org-scoped via RLS), errors if not found or `status !== 'published'`.
- New `listCampaignEmailTemplates()` server action returns the org's `published` templates (`{ id, name }[]`, ordered by name), RLS-scoped — no manual `org_id` filter.

### Task 2 — wizard picker (commit `c09a5fe9`)
- Extended the `../actions` import with `listCampaignEmailTemplates`.
- Added `emailTemplates` / `loadingEmailTemplates` / `emailTemplateId` state.
- `[step, channel]` useEffect loads published templates when `step === 4 && channel === 'email'` (mirrors the whatsapp loader).
- `canProceedStep4()` gains `if (channel === 'email') return !!emailTemplateId`.
- `handleSubmit` passes `email_template_id: channel === 'email' ? emailTemplateId : null` to `createCampaign`.
- The "Email template configuration coming soon" stub is replaced with a real picker (loading / empty / native-select states, matching the wizard's input idiom) plus a merge-tag hint line.

## Verification

- `npm run build` → exit 0 (server action + client wizard compile).
- `grep` guardrails: `email_template_id` ×5 in actions.ts; `listCampaignEmailTemplates` exported; `template_config` still the JSONB sink (no new column); wizard references `listCampaignEmailTemplates`/`emailTemplateId` and the `email_template_id: channel === 'email'` submit line; `Email template configuration coming soon` count = 0.
- No new file under `supabase/migrations/` (code-only — confirmed).

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None — the "coming soon" stub was removed and replaced with a working picker + gate. Runtime end-to-end (a campaign actually sends via the chosen template) is a post-deploy human-verify, explicitly deferred in 121-CONTEXT.

## Self-Check: PASSED

- FOUND: src/app/(dashboard)/campaigns/actions.ts (modified)
- FOUND: src/app/(dashboard)/campaigns/_components/new-campaign-wizard.tsx (modified)
- FOUND commit: 699e4480
- FOUND commit: c09a5fe9
