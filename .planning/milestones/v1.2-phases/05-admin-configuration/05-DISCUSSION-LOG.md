# Phase 5: Admin Configuration - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md - this log preserves the alternatives considered.

**Date:** 2026-04-04
**Phase:** 05-admin-configuration
**Areas discussed:** Configuration Storage, Dashboard Surface, Preview Strategy, Public Config Delivery, Token Rotation, Scope Guardrails

---

## Configuration Storage

### Where widget settings live

| Option | Description | Selected |
|--------|-------------|----------|
| `organizations` columns | Add config fields to the existing org record beside `widget_token`. | ✓ |
| New `widget_configs` table | Separate table for widget settings per org. | |
| Static env/config file | Global defaults outside the database. | |

**User's choice:** `organizations` columns
**Notes:** Smallest fit for one-widget-per-org scope. Avoids introducing another table before there is a real multi-widget use case.

---

## Dashboard Surface

### Where admins manage widget settings

| Option | Description | Selected |
|--------|-------------|----------|
| Dedicated `/widget` page | First-class product area with its own sidebar item. | ✓ |
| Add section under Organizations | Reuse org admin page for widget settings. | |
| Modal launched from dashboard | Lightweight but hidden/discoverability is worse. | |

**User's choice:** Dedicated `/widget` page
**Notes:** This is an active operational surface, not just org metadata.

---

## Preview Strategy

### How the admin preview works

| Option | Description | Selected |
|--------|-------------|----------|
| Local preview component | Mimic the widget UI inside the dashboard without loading `public/widget.js`. | ✓ |
| Embed the real widget script | Preview by mounting the actual production widget. | |
| Static mock image | Non-interactive visual placeholder only. | |

**User's choice:** Local preview component
**Notes:** Keeps preview deterministic and avoids coupling dashboard UX to the public embed artifact.

---

## Public Config Delivery

### How the widget gets org-specific UI settings

| Option | Description | Selected |
|--------|-------------|----------|
| Separate config endpoint | `GET /api/widget/[token]/config` returns public-safe fields only. | ✓ |
| Extend chat POST response | First message response also returns config. | |
| Inline config in script tag | Push all values into `data-*` attributes. | |

**User's choice:** Separate config endpoint
**Notes:** Boot-time config and chat traffic stay decoupled; embed tag stays minimal.

---

## Token Rotation

### How token regeneration works

| Option | Description | Selected |
|--------|-------------|----------|
| Replace `widget_token` with new UUID | Immediate invalidation of old installs. | ✓ |
| Keep version history | Support temporary overlap between old and new tokens. | |
| Soft-disable old token later | Delay invalidation until a later cutoff. | |

**User's choice:** Replace `widget_token` with new UUID
**Notes:** Matches `ADMIN-04` directly and requires no extra schema.

---

## Scope Guardrails

### Whether system prompt editing belongs in Phase 5

| Option | Description | Selected |
|--------|-------------|----------|
| Defer system prompt | Keep Phase 5 limited to `ADMIN-01..04`. | ✓ |
| Add system prompt now | Expand scope to include behavior tuning. | |
| Leave to planner | Decide later during plan creation. | |

**User's choice:** Defer system prompt
**Notes:** Phase 3 mentioned it as a future override point, but the actual milestone requirements do not include it.

---

## Claude's Discretion

- Exact visual layout of the dashboard page
- Final copy for the token regeneration warning
- Whether the preview includes sample messages or just the welcome state
- Whether empty DB values are stored as null or normalized defaults

## Deferred Ideas

- System prompt editor
- Rich theme controls
- Widget analytics
- Multiple widget profiles per org
