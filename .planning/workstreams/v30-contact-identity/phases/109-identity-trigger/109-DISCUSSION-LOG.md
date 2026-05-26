# Phase 109: IDENTITY-TRIGGER - Discussion Log

> **Audit trail only.** Not consumed by downstream agents.

**Date:** 2026-05-26
**Phase:** 109-identity-trigger
**Areas discussed:** Trigger architecture, Pre-flight check, Promotion semantics, Zod strategy

User replied "faca o recomendado" — discuss all four areas, pick recommended.

## Trigger Architecture

| Option | Description | Selected |
|---|---|---|
| 3 triggers: DEFERRABLE constraint + BEFORE DELETE + BEFORE UPDATE promote | Each concern isolated. DEFERRABLE allows Phase 108 webhook flow. | ✓ |
| Single BEFORE INSERT trigger with status-based skip | Channel_only status bypasses check. Risk: window where invariant is violated. | |
| AFTER trigger with side-channel queue | Async resolution. Complex, overkill. | |

## Pre-Flight Check

| Option | Description | Selected |
|---|---|---|
| DO block RAISE EXCEPTION if violators >0 | Forces cleanup before trigger lands. No-op in prod (1 contact has phone+email). | ✓ |
| Skip pre-flight, let trigger fail on later operations | Could leave invariant-violating rows undetected indefinitely. | |
| Add CHECK constraint instead | CHECK can't reference other tables. | |

## Promotion Semantics

| Option | Description | Selected |
|---|---|---|
| Bump on phone OR email, no auto-downgrade | Simple state machine. Symmetric not required. | ✓ |
| Bump only when both phone AND email present | Too strict; many channel→identified transitions only have phone. | |
| Bidirectional state machine | Complex; downgrade is a data-hygiene concern, not an invariant. | |

## Zod Strategy

| Option | Description | Selected |
|---|---|---|
| Keep Zod strict, DB trigger is universal looser enforcer; document divergence | Forms always have name; webhooks bypass Zod; DB enforces. | ✓ |
| Relax Zod to match DB invariant | Breaks form UX which expects name. | |
| Two separate schemas (manual + webhook) | Adds maintenance burden without clear benefit. | |

## Claude's Discretion
- Migration filename
- Trigger function naming
- BEGIN/COMMIT wrap in apply script
- Error message wording

## Deferred Ideas
- Auto-downgrade identified → channel_only — not an invariant violation
- merge_conflict auto-resolution — Phase 110
- Verified state triggers — Phase 110
- Trigger telemetry — Phase 110
- Form UI for channel_only — webhooks-only for now
