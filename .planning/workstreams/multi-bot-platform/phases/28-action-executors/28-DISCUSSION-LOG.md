# Phase 28: Action Executors - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-07
**Phase:** 28-action-executors
**Areas discussed:** Token refresh strategy, find result format, No-integration error

---

## Gray Area Selection

| Option | Selected |
|--------|----------|
| Token refresh strategy | ✓ |
| find result format | ✓ |
| No-integration error | ✓ |

**User's choice:** "fac ao recomendado" — all recommended options across all areas

---

## Token Refresh Strategy

| Option | Description | Selected |
|--------|-------------|----------|
| Refresh-on-401 | Try API call; if 401, refresh token + retry once; persist new token to DB | ✓ |
| Always refresh before call | Fetch new token before every executor call — always fresh but slower | |
| Skip for now | Document 1h limitation, handle in future milestone | |

**User's choice:** Refresh-on-401 (recommended)
**Notes:** Phase 27 explicitly deferred token refresh to this phase. Refresh-on-401 avoids an extra round-trip on every call while still handling expiry gracefully. New token persisted to `integrations` row so subsequent calls don't need to re-refresh.

---

## `find` Result Format

| Option | Description | Selected |
|--------|-------------|----------|
| Summary string | Single-line: "Found: Name \| email \| phone" — consistent with other executors | ✓ |
| JSON blob | Full People API response — richer but verbose for LLM | |
| Structured fields only | Return key-value pairs for specific fields | |

**User's choice:** Summary string (recommended)
**Notes:** Consistent with GHL executors which all return plain strings. No newlines for Vapi parser compat. First match returned when multiple exist, with count note.

---

## No-Integration Error

| Option | Description | Selected |
|--------|-------------|----------|
| Throw descriptive Error | `new Error('Google Contacts not connected...')` — action engine catches, logs, no crash | ✓ |
| Return empty string | Silent failure — harder to debug | |
| Return error string (no throw) | Return string like `"Error: not connected"` — inconsistent with executor pattern | |

**User's choice:** Throw descriptive Error (recommended)
**Notes:** Consistent with how `knowledge_base` case handles missing ctx. Action engine already catches thrown errors and logs them as failed action_log entries.

---

## Claude's Discretion

- Executor file structure under `src/lib/google-contacts/`
- People API endpoint selection for each operation
- `updatePersonFields` mask construction
- Token refresh utility location (`credentials.ts`)
- Contact lookup implementation for update/delete

## Deferred Ideas

- Batch operations — future requirement
- Proactive token refresh cron — future milestone
- Multiple Google accounts per org — Future Requirements
