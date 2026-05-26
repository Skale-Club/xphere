# Phase 108: CHANNEL-IDENTITIES - Discussion Log

> **Audit trail only.** Not consumed by downstream agents.

**Date:** 2026-05-26
**Phase:** 108-channel-identities
**Areas discussed:** Provider enum scope, ROADMAP #5 correction, Webhook lookup-first pattern, contacts.source deprecation

User replied "faca o recomendado" — discuss all four areas, pick recommended.

## Provider Enum Scope

| Option | Description | Selected |
|---|---|---|
| Wide enum (8 providers up front) | List all known + planned. Adding more later still requires ALTER CHECK, but listing now avoids N small migrations. | ✓ |
| Narrow enum (3 current contact-creators) | Just whatsapp/evolution/telegram. Each new provider = new migration. | |
| No CHECK constraint (free text) | Loses type safety, easy bugs. | |

## ROADMAP Success #5 Correction

| Option | Description | Selected |
|---|---|---|
| Replace Vapi/ManyChat with whatsapp/evolution/telegram | Matches Phase 107 research reality. Vapi/ManyChat don't create contacts. | ✓ |
| Keep Vapi/ManyChat in scope as update-only | They don't create contacts so there's no creation path to update. Vacuous. | |
| Leave ROADMAP as-is and produce dead plan tasks | Would fail at execution. | |

## Webhook Lookup-First Pattern

| Option | Description | Selected |
|---|---|---|
| 3-step lookup: channel → phone/email → create | Solves "lead reaches us via two channels" without duplicating contact. | ✓ |
| Create-first, never lookup | Loses identity continuity. | |
| Only channel lookup (skip phone/email) | Misses the cross-channel case (Instagram lead later texts). | |

## contacts.source Deprecation

| Option | Description | Selected |
|---|---|---|
| Keep writing source + comment as deprecated; switch reads to channel_identities | Maximum back-compat, no field break. | ✓ |
| Stop writing source immediately | Risks breaking unknown callers. | |
| Drop column now | Phase 110 is the right time, not now. | |

## Claude's Discretion
- Migration filename
- Index strategy on contact_channel_identities
- Helper file placement (recommend same file as Phase 107 helpers)
- Specific call sites reading contacts.source

## Deferred Ideas
- Identity invariant trigger → Phase 109
- contacts.source column drop → Phase 110
- Verified channel identity → Phase 110
- UI channel badges → Phase 110
- Vapi/ManyChat channel attribution → future, not needed
- Bulk reassign / audit log → future
