# Phase 107: UNIQUE-CONSTRAINTS - Discussion Log

> **Audit trail only.** Not consumed by downstream agents.

**Date:** 2026-05-26
**Phase:** 107-unique-constraints
**Areas discussed:** Multi-conflict resolution, ON CONFLICT strategy, Webhook unique-violation, Form UX on dup detect

User replied "faca o recomendado" — discuss all four areas, pick the recommended option for each.

---

## Multi-conflict Resolution

| Option | Description | Selected |
|--------|-------------|----------|
| Pre-check both + flag merge_conflict on mismatch | App pre-check identifies conflicts; new row with `identity_status='merge_conflict'` surfaces in Phase 106 UI. UNIQUE constraint is defense in depth. | ✓ |
| Try ON CONFLICT (phone), fallback to email | Cannot target both indexes in one INSERT — would need retry logic that's hard to read. | |
| Reject the insert outright | Bad UX — webhooks can't recover, leads (real signal) silently dropped. | |

---

## ON CONFLICT Strategy

| Option | Description | Selected |
|--------|-------------|----------|
| DO NOTHING + SELECT existing | Identity dedup is identity dedup. Webhook data doesn't overwrite curated fields. | ✓ |
| DO UPDATE on all fields | "Last write wins" silently overwrites; risk of data loss. | |
| DO UPDATE on updated_at only | Considered as middle ground — leaving as part of D-02b (touch allowed) | partial |

---

## Webhook Unique-Violation Handling

| Option | Description | Selected |
|--------|-------------|----------|
| SELECT existing + continue with downstream work + log metric | Webhook's actual job (create conversation/message) still happens; contact data preserved. | ✓ |
| Bail and 200 OK | Loses real signal. | |
| Enrich existing contact | Phase 110 work; not now. | |

---

## Form UX on Duplicate

| Option | Description | Selected |
|--------|-------------|----------|
| Toast "Contato já existe — abrir <link>" | Conservative, predictable, user keeps control. | ✓ |
| Auto-redirect to existing | User may not notice the redirect; surprising. | |
| Inline merge UI in form | Already covered by Phase 106 admin UI — would duplicate work. | |

---

## Claude's Discretion
- Migration filename
- Audit guard wrap style (DO block vs separate query)
- Collision log structured format

## Deferred Ideas
- ON CONFLICT DO UPDATE for enrichment → Phase 110+
- Auto-resolution of merge_conflict → Phase 110+
- Collision metrics dashboard → Phase 110+
- Cross-org duplicate detection → never (multi-tenancy invariant)
