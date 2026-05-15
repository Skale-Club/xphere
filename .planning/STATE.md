---
gsd_state_version: 1.0
milestone: v1.9
milestone_name: GHL Lost-Lead Reengagement (SMS)
status: in_progress
stopped_at: Defining requirements
last_updated: "2026-05-15T00:00:00.000Z"
last_activity: 2026-05-15
progress:
  total_phases: 0
  completed_phases: 0
  total_plans: 0
  completed_plans: 0
---

# Operator - State

## Current Position

Phase: Not started (defining requirements)
Plan: —
Status: Defining requirements
Last activity: 2026-05-15 — Milestone v1.9 started

## Milestone Progress

- v1.0 MVP: ✅ Shipped 2026-04-03
- v1.1 Knowledge Base: ✅ Shipped 2026-04-03
- v1.2 Operator + Embedded Chatbot: ✅ Shipped 2026-04-05
- v1.3 Google Reviews Widget + Meta Messaging: ✅ Shipped 2026-05-05
- v1.4 Chat System Refactor: ✅ Shipped 2026-05-05
- v1.5 Tools Folder System: ✅ Shipped 2026-05-06
- v1.6 ManyChat Integration: ✅ Shipped 2026-05-07
- v1.7 Google Contacts Integration: ✅ Shipped 2026-05-07 ⚠️ pending Google Cloud credentials
- v1.8 Executor Completeness: ✅ Shipped 2026-05-08
- v1.9 GHL Lost-Lead Reengagement (SMS): 🚧 Active — defining requirements

## Project Reference

See `.planning/PROJECT.md` for vision, validated requirements, decisions.
See `.planning/MILESTONES.md` for shipped history.
See `.planning/ROADMAP.md` for phase details.

**Core value:** The Action Engine must work reliably for every tenant
**App name:** Operator
**Production origin:** https://operator.skale.club

## Accumulated Context

### v1.9 Scope

MVP de reengagement SMS para a sub-account Skleanings no GoHighLevel. Job diário (GitHub Action) chama endpoint protegido que: lista Lost opportunities > 180 dias → envia SMS via Twilio → loga + marca anti-loop.

Critical pieces:

- GHL API: precisa adicionar `listOpportunities(locationId, { status, updatedBefore })` em `src/lib/ghl/` (hoje só tem create-contact, create-appointment, get-availability)
- Twilio: reusar `src/lib/twilio/send-sms.ts` (executor 1-SMS já validado em v1.8)
- Anti-loop: nova migration + tabela `ghl_reengagement_sent` (org_id, ghl_contact_id, sent_at, UNIQUE constraint)
- Scheduler: novo arquivo em `.github/workflows/` (já existe pattern de keepalive scheduled action)
- Endpoint: `POST /api/automations/ghl-reengagement/run` retorna `{ processed, sent, skipped, errors }`
- Config via env vars (sem UI nessa milestone):
  - `GHL_REENGAGEMENT_LOCATION_ID` (sub-account)
  - `GHL_REENGAGEMENT_INTEGRATION_ID` (qual integration row usar)
  - `GHL_REENGAGEMENT_TWILIO_INTEGRATION_ID`
  - `GHL_REENGAGEMENT_MESSAGE` (template com `{{first_name}}`)
  - `GHL_REENGAGEMENT_TRIGGER_SECRET` (bearer pro endpoint)

Pattern references:

- Twilio executor: `src/lib/twilio/send-sms.ts` (v1.8)
- Action logging: `src/lib/action-engine/execute-action.ts` (action_logs insert pattern)
- GHL client: `src/lib/ghl/client.ts` (Bearer + Version header pattern)
- Cred decryption: `decrypt(integrations.encrypted_api_key)` then JSON parse

Reserved for future milestone (não fazer agora):
- Tabela `automations` genérica + UI de automações
- Audience filters configuráveis
- Multi-canal (email, WhatsApp)
- Multi-cliente / múltiplas regras

## Decisions

- [v1.9] Hardcoded para Skleanings via env vars — versão multi-cliente é trabalho de plataforma, fica para milestone futura
- [v1.9] GitHub Actions como scheduler — projeto já usa pra keepalive; evita custo de Vercel Cron e mantém scheduling externo ao app
- [v1.9] Anti-loop persistido em DB (não em GHL tag) — fonte da verdade no nosso lado, evita depender de tags GHL que podem ser removidas

## Pending Todos

- ⚠️ (v1.7) Register Google OAuth app in Google Cloud Console + set GOOGLE_CLIENT_ID/SECRET in Vercel

## Session Continuity

Last session: 2026-05-15T00:00:00.000Z
Stopped at: v1.9 milestone started — defining requirements

## Performance Metrics

| Phase | Plan | Duration | Tasks | Files |
|-------|------|----------|-------|-------|
| 30 | 04 | 8 min | 2/2 | 3 |
| 31 | 01 | 12 min | 1/1 | 2 |
