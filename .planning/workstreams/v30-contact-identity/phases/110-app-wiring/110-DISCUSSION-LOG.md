# Phase 110: APP-WIRING - Discussion Log

> **Audit trail only.** Not consumed by downstream agents.

**Date:** 2026-05-26
**Phase:** 110-app-wiring
**Areas discussed:** Verification triggers scope, contacts.source drop, Detail page, Placeholder email config

User answered each question with the Recommended option.

## Verification Triggers

| Option | Description | Selected |
|---|---|---|
| Manual only | Button + server action. Defer SMS/email triggers. | ✓ |
| Manual + email | Adds email send + verification endpoint. | |
| Full (manual + SMS + email) | Adds inbound SMS routing. Highest scope. | |

## contacts.source Drop

| Option | Description | Selected |
|---|---|---|
| Defer, keep DEPRECATED | No call-site sweep this phase. Drop in follow-up. | ✓ |
| Drop now | Risky without comprehensive audit. | |
| Drop + fallback view | Adds DDL ceremony. | |

## Detail Page

| Option | Description | Selected |
|---|---|---|
| Badge in contact-info-panel + filter in list | No new page. | ✓ |
| Build /contacts/[id] | Big lift outside identity scope. | |
| Badge + explicit filter | Equivalent to first. | |

## Placeholder Emails

| Option | Description | Selected |
|---|---|---|
| Hardcoded list | Simple. Ship first. | ✓ |
| Per-org via org_settings | More flexible, more scope. | |

## Reduced Scope Acknowledged
Phase 110 deliberately ships ~50% of original ROADMAP scope:
- ✓ contact_verifications table + manual mark
- ✓ Badge in panel
- ✓ Conflict filter in list
- ✓ CSV pre-flight dedup
- ✓ Hardcoded placeholder rejection
- ⏸ SMS reply / email click triggers → follow-up
- ⏸ contacts.source DROP → follow-up
- ⏸ /contacts/[id] page → follow-up

## Claude's Discretion
- Migration filename
- Badge styling
- CSV pre-flight UI placement
- Confirmation modal for "Mark verified"
- Banner if conflicts exist

## Deferred Ideas
- All SMS/email verification infrastructure
- contacts.source removal
- Per-org email block patterns
- /contacts/[id] detail page
- Verified privileges UX
- Auto-verification on first reply
- Verified flag in CSV export
- Pre-existing 65 failing tests in unrelated suites
