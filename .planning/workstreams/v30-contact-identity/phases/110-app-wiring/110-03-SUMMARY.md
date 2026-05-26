---
phase: 110-app-wiring
plan: 03
subsystem: contact-identity
tags: [verification, server-action, ui, rls, idempotency]
requires:
  - migration-1062-contact-verifications  # Plan 01
  - identity-status-enum                  # Phase 105 (1056)
  - is_verified-derived-field             # Plan 02 (getContact field)
provides:
  - markContactVerified-server-action
  - MarkVerifiedButton-ui
  - identified-to-verified-promotion-path
affects:
  - src/components/chat/contact-info-panel.tsx
  - src/app/(dashboard)/contacts/_actions/verify.ts
tech-stack:
  added: []
  patterns:
    - "RLS-gated INSERT + idempotent 23505 UNIQUE handling"
    - "Conditional UPDATE WHERE status='identified' guard (Pitfall 2)"
    - "Server action pattern with cached getUser() (CLAUDE.md)"
key-files:
  created:
    - src/app/(dashboard)/contacts/_actions/verify.ts
    - tests/contact-verifications.test.ts
  modified:
    - src/components/chat/contact-info-panel.tsx
decisions:
  - "D-01 implemented: manual verification only, INSERT contact_verifications + conditional UPDATE bump"
  - "D-01a implemented: Mark verified button shows when identity_status='identified' + sonner toast"
  - "Pitfall 6 closed: UPDATE only runs after INSERT succeeds (or 23505 idempotent); RLS-rejected INSERT short-circuits"
  - "Pitfall 2 closed: status guard in WHERE clause makes channel_only/merge_conflict/archived_duplicate no-op"
  - "Identifier selection: phone first, email fallback (production priority)"
metrics:
  duration: "~25min"
  completed: "2026-05-26"
  tasks: 2
  tests: "7 integration tests, all passing against prod DB"
---

# Phase 110 Plan 03: markContactVerified + Mark verified Button Summary

One-liner: Admin manual verification path — server action + UI button that promote `identity_status='identified'` contacts to `'verified'` via RLS-gated, idempotent INSERT into `contact_verifications` with conditional status bump.

## What Shipped

### Task 1: `markContactVerified` server action (CID-14, D-01)

**File:** `src/app/(dashboard)/contacts/_actions/verify.ts`

**Signature:**

```ts
export async function markContactVerified(
  input: MarkContactVerifiedInput,
): Promise<{ ok: true } | { ok: false; error: string }>
```

**Behavior:**

1. Resolve user via cached `getUser()` (CLAUDE.md compliance — never `supabase.auth.getUser()` directly).
2. Resolve active org via `get_current_org_id()` RPC.
3. INSERT into `contact_verifications` (RLS gates this to org admins, per migration 1062).
4. If `insErr.code === '23505'` → treat as idempotent success (Pitfall 6).
5. If `insErr` with any other code → return error and **skip the UPDATE** (Pitfall 6 — prevents non-admins bypass-bumping status without an audit row).
6. Conditional UPDATE `contacts SET identity_status='verified' WHERE id=$1 AND identity_status='identified'` — channel_only / merge_conflict / archived_duplicate / verified are no-ops (D-01 + Pitfall 2).
7. `revalidatePath('/contacts')` so the conflict filter chip counter (Plan 04+) picks up the new state (Pitfall 10).

**Integration tests:** `tests/contact-verifications.test.ts` — 7 tests, all passing (3.47s against prod DB):

| Test | Coverage |
| ---- | -------- |
| T1 | INSERT contact_verifications succeeds for identified contact |
| T2 | UNIQUE collision returns 23505 (idempotent re-verification) |
| T3 | CASCADE on contact delete removes verification rows |
| T4 | Conditional UPDATE bumps `identified` → `verified` |
| T5 | Status guard: `channel_only` NOT bumped (rowCount=0) |
| T6 | Status guard: `merge_conflict` NOT bumped (rowCount=0) |
| T7 | Status guard: `archived_duplicate` NOT bumped (rowCount=0) |

RLS-gated rejection (unauthenticated / non-admin) is exercised at the action layer in higher-level suites — service-role pg client bypasses RLS by design (matches `tests/contact-identity-trigger.test.ts` precedent).

**Commit:** `956aeba`

### Task 2: `MarkVerifiedButton` in contact-info-panel (CID-14, D-01a)

**File:** `src/components/chat/contact-info-panel.tsx`

**Added imports:** `markContactVerified` from `_actions/verify`. (`CheckCircle2`, `toast`, `Button`, `React` already present.)

**Added subcomponent:** `MarkVerifiedButton({ contactId, identifierType, identifierValue, onMarked })` — ghost button with `CheckCircle2` icon, "Mark verified" label, `saving` pending state, double-click guard. On success: `toast.success('Contact verified')` + `onMarked()` (calls panel `refresh`). On error: `toast.error(res.error)`.

**Conditional render** (next to `IdentityStatusBadge` inside the same flex container, header line ~493):

```tsx
{contact.identity_status === 'identified' &&
  !contact.is_verified &&
  (contact.phone || contact.email) && (
    <MarkVerifiedButton
      contactId={contact.id}
      identifierType={contact.phone ? 'phone' : 'email'}
      identifierValue={(contact.phone ?? contact.email)!}
      onMarked={refresh}
    />
  )}
```

**Pitfall 2 enforcement:** Triple-gated — status must be `'identified'` AND `!is_verified` (Plan 02's derived field) AND at least one of phone/email present. Channel-only contacts (no phone/email) cannot reach this branch even if they ever flipped to `identified`. merge_conflict / archived_duplicate / already-verified never render the button.

**Identifier selection:** phone-first, email fallback — matches production priority (phone is the primary identity in this product).

**Commit:** `945daf4`

## Deviations from Plan

### Auto-fixed Issues

None — plan executed as written.

### Coordination with Parallel Wave 2

The badge insertion point and `IdentityStatusBadge` import were already merged by Plan 04 (parallel wave 2). Plan 03 extended that same flex container with the conditional `MarkVerifiedButton` rather than creating a duplicate badge row. The pre-existing comment ("Plan 03 will render MarkVerifiedButton next to it inside this same flex container") flagged the exact insertion site, so no re-architecting was needed.

## Verification

```bash
# Tests
npx vitest run tests/contact-verifications.test.ts
# → 7 passed (3.47s)

# Build
npm run build
# → exit 0 (full route table emitted)

# Wire grep
grep -r markContactVerified src/
# → 2 hits: action file + button caller
```

## Decisions Implemented

- **D-01** — Manual verification only; server action shape matches `markContactVerified(contactId, identifierType, identifierValue, method='manual')`.
- **D-01a** — UI "Mark verified" button in contact-info-panel header; sonner `toast.success('Contact verified')` on completion.
- **Pitfall 6** — UPDATE strictly gated on prior INSERT success (or 23505 idempotent path); audit-row-required invariant preserved.
- **Pitfall 2** — `identity_status='identified'` clause in UPDATE WHERE + triple-gated UI render prevents accidental bumps of other states.
- **Pitfall 10** — `revalidatePath('/contacts')` ensures conflict filter and any list-page identity_status rendering refresh after a successful verify.

## Self-Check: PASSED

- `src/app/(dashboard)/contacts/_actions/verify.ts` exists
- `tests/contact-verifications.test.ts` exists (7 tests)
- `src/components/chat/contact-info-panel.tsx` modified (MarkVerifiedButton + conditional render)
- Commit `956aeba` (feat 110-03 task 1) confirmed in `git log`
- Commit `945daf4` (feat 110-03 task 2) confirmed in `git log`
- `npm run build` exits 0
- 7/7 integration tests pass
