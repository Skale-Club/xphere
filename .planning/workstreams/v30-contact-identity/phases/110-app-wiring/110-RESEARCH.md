# Phase 110: APP-WIRING - Research

**Researched:** 2026-05-26
**Domain:** Next.js 16 App Router + Supabase (PostgreSQL/RLS) — contact identity surface wiring
**Confidence:** HIGH

## Summary

Phase 110 is the user-visible cap on the v3.0 contact-identity workstream. After 5 phases of pure DB infrastructure (1056-1061), this phase ships the smallest dense layer of features that make the identity model useful in the app: migration **1062 `contact_verifications`**, a 5-state badge in `contact-info-panel.tsx`, a conflict filter chip on `/contacts`, a CSV import pre-flight powered by Phase 107's normalized columns, and a hardcoded `BLOCKED_EMAIL_PATTERNS` list to keep `noemail@*`-style placeholders out of the dedup index.

The scope is reduced from ROADMAP. Three ROADMAP success-criteria items are explicitly deferred: SMS reply-yes / email-link verification (no inbound infra), `/contacts/[id]` detail page (does not exist today), and `contacts.source` column drop (needs full call-site audit). What ships is all schema/UI/server-action work in app code plus one migration.

**Primary recommendation:** Author migration 1062 mirroring 1057's `contact_merge_exclusions` RLS template (SELECT for org members, INSERT/UPDATE/DELETE gated by `org_members.role='admin'`). Build `IdentityStatusBadge` as a self-contained component keyed on `identity_status`. Switch CSV import dedup from `phone`/`email` to `phone_e164`/`email_normalized` and return `{ wouldInsert, wouldUpdate, wouldSkip, wouldError, conflictCount, blockedEmailCount }` so the wizard's existing `DryRunResult` shape only grows two fields. Wire `isBlockedEmail` at four layers (Zod refine, `createContact`, CSV import, webhook handlers) for defense in depth.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01 Manual verification only.** New server action `markContactVerified(contactId, identifierType, identifierValue, method='manual')` inserts row in `contact_verifications` and updates `contacts.identity_status` to `'verified'` if currently `'identified'`. Does NOT downgrade `merge_conflict` and does NOT upgrade `channel_only` (must promote to identified first).
- **D-01a UI:** "Mark verified" button in contact-info-panel when `identity_status='identified'`. Sonner toast on success.
- **D-01b:** Admin can mark contacts verified from `/admin/contacts/conflicts` cluster cards on resolution (optional).
- **D-01c:** SMS reply-yes + email link click triggers DEFERRED to follow-up milestone.

- **D-02 contacts.source DROP DEFERRED.** Phase 110 does NOT modify any `contacts.source` reads. DEPRECATED comment from Phase 108 stays.

- **D-03 No new /contacts/[id] page.** Identity badge ships in `contact-info-panel.tsx` (where MergedBanner already lives).
- **D-03a:** Conflict filter ships on `/contacts/page.tsx` — filter chip "Show conflicts only" + total conflict counter.

- **D-04 Hardcoded blocked-email list** in `src/lib/contacts/blocked-emails.ts`:
  ```ts
  export const BLOCKED_EMAIL_PATTERNS = [
    /^noemail@/i,
    /^test@test\./i,
    /^none@/i,
    /^example@/i,
    /^placeholder@/i,
    /^noreply@/i,
    /@example\.(com|org)$/i,
  ]
  export function isBlockedEmail(email: string): boolean { ... }
  ```
- **D-04a Wire into:** `contactSchema` Zod refine, `createContact` server action, CSV import (skip blocked emails with error log), Webhook handlers (skip identity attach if email is blocked but accept the contact via phone).
- **D-04b:** Per-org configurability DEFERRED.

- **D-05 Migration 1062** creates `contact_verifications` with columns `(id, org_id, contact_id, identifier_type CHECK IN ('phone','email'), identifier_value, method CHECK IN ('manual','sms_reply','email_click','oauth'), verified_at, verified_by)`. Plus UNIQUE `(org_id, contact_id, identifier_type, identifier_value)`. Plus RLS scoped to `get_current_org_id()`, 4 policies, org admins write. Plus INDEX `(contact_id)`.
- **D-05a:** Method enum includes future values (`sms_reply`, `email_click`, `oauth`) to avoid future ALTER; Phase 110 writes only `manual`.

- **D-06 CSV import pre-flight refactor:**
  - Switch lookup to `phone_e164` / `email_normalized` (Phase 105 generated columns).
  - Surface counts: `{ totalRows, conflictRows, willCreate, willSkip }`.
  - UI shows counts before "Start import" enables.
  - Blocked-email rows: skip with `error: 'blocked_email'`.
  - Multi-conflict rows: insert as `merge_conflict` (consistent with createContact behavior).
- **D-06a:** Existing `contact_imports`/`contact_import_errors` schema unchanged.

- **D-07 New component** `src/components/contacts/identity-status-badge.tsx`:
  - `channel_only` → blue "Channel only" + tooltip
  - `identified` → green "Identified"
  - `verified` → green + checkmark "Verified"
  - `merge_conflict` → orange "Conflict" + link to `/admin/contacts/conflicts`
  - `archived_duplicate` → gray "Archived" (admins only)
- **D-07a:** Rendered in `contact-info-panel.tsx`. Mirrors existing badge usage.

- **D-08 Conflict filter chip on /contacts:** chip "Conflicts" with count of `identity_status='merge_conflict'`. Click toggles filter (query gains `.eq('identity_status', 'merge_conflict')`). Chip disabled with count 0 (no flash) when no conflicts.

### Claude's Discretion

- Exact migration filename (1062_*.sql).
- Badge styling (Tailwind classes per design system).
- CSV pre-flight UI placement (before vs after column mapping step).
- Whether "Mark verified" requires a confirmation modal or one-click.
- Whether to show banner if any conflicts exist on /contacts page (recommend yes, dismissible).

### Deferred Ideas (OUT OF SCOPE)

- SMS reply-yes verification trigger (needs Twilio inbound + NL parsing of "sim/yes").
- Email link click verification trigger (needs email send + verification endpoint + token signing).
- `/contacts/[id]` detail page (full detail page is separate work).
- `contacts.source` column DROP (needs comprehensive call-site audit).
- Per-org `org_settings.blocked_email_patterns` (configurability follow-up).
- Verified contact privileges (UX consequence design).
- Auto-verification on first reply (follow-up).
- Verified status visible in CSV export.
- 65 pre-existing failing tests in unrelated suites.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| CID-14 | Verified state (contact_verifications + manual mark + badge surface) | §"contact_verifications Migration", §"markContactVerified Server Action", §"IdentityStatusBadge" |
| CID-15 | Conflict surface (filter chip + counter + badge link) | §"Conflict Filter on /contacts", §"Conflict Counter Query", §"IdentityStatusBadge" |
| CID-16 | Import hardening (normalized-column pre-flight + blocked email rejection) | §"CSV Import Pre-Flight Refactor", §"isBlockedEmail" |

The remaining CID requirements (01-13) are delivered by Phases 105-109 — RESEARCH.md only references them as binding context.
</phase_requirements>

## Project Constraints (from CLAUDE.md)

- **Build verification:** Always run `npm run build` after changes to catch type errors before finishing.
- **Migrations:** Live in `supabase/migrations/`. After adding a migration: (1) `npx supabase db push` OR pooler-pg apply pattern; (2) Update `src/types/database.ts` manually (manual patch precedent from Phases 105-108).
- **Multi-tenancy:** Every new table needs RLS. `get_current_org_id()` resolves active org. Don't manually filter by `org_id` in authenticated-client queries — RLS does it.
- **Auth helpers:** Use `getUser()` and `createClient()` from `@/lib/supabase/server` (cached). Never call `supabase.auth.getUser()` directly.
- **Webhooks always return HTTP 200.** `isBlockedEmail` skip path must not throw or return non-200.
- **Sensitive paths:** `supabase/migrations/` — never edit old migrations. Only add 1062.
- **Forms:** `react-hook-form` + `zod` + `zodResolver`. Toasts via `sonner`. (Already established pattern in existing form components.)

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Next.js | 16 (App Router) | Pages, server actions, route handlers | Repo standard |
| TypeScript | 5 (strict) | All app code | Repo standard |
| Supabase JS | (in `@supabase/supabase-js`) | Auth-aware DB client | Repo standard |
| zod | (already installed) | Schema validation in `contactSchema` | Form layer |
| shadcn `Badge` | local `@/components/ui/badge` | 5-state identity badge | Existing primitive |
| sonner | (already installed) | Mark-verified success toast | Repo standard |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| lucide-react | (installed) | `CheckCircle2`, `AlertTriangle`, `Link2` icons in badge | Identity-state icons |
| `pg` (pooler) | (in apply-*.mjs) | Migration apply path | `apply-1062.mjs` |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Hardcoded regex list | DB-stored `org_settings.blocked_email_patterns` | Configurable per-org but adds migration + settings UI — D-04b defers this |
| Server-component count query | Client-side count aggregator | RLS-safe direct query is simpler; client fetch needs extra round-trip |

**Installation:** No new npm packages needed. All primitives already installed.

## Architecture Patterns

### Migration 1062 Body (ready-to-paste)

```sql
-- =============================================================================
-- Migration 1062: Contact Verifications (CID-14)
--
-- Phase 110 of v3.0 Contact Identity workstream. Adds verification audit log
-- and enables the manual "Mark verified" admin path. Future SMS/email-click
-- triggers write to the same table without schema change.
--
-- Depends on:
--   * 1056 (identity_status enum on contacts)
--   * 1057 (RLS template + org_members admin-gating pattern)
--   * 1060/1061 (no functional dep; ordering only)
--
-- Scope (CID-14):
--   * contact_verifications table
--   * UNIQUE (org_id, contact_id, identifier_type, identifier_value)
--   * INDEX (contact_id) for reverse lookup (badge "is this contact verified?")
--   * CHECK enums on identifier_type ('phone','email') and method
--     ('manual','sms_reply','email_click','oauth') — wide enum to avoid
--     future ALTER (D-05a)
--   * RLS enabled with 4 policies: SELECT for org members, INSERT/UPDATE/DELETE
--     gated by org_members.role='admin' (mirrors 1057 template)
--
-- NOT in scope: SMS/email triggers (deferred), source column drop (deferred).
-- =============================================================================

-- ----- Section 1: contact_verifications table -------------------------------

CREATE TABLE IF NOT EXISTS public.contact_verifications (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  contact_id        uuid NOT NULL REFERENCES public.contacts(id)       ON DELETE CASCADE,
  identifier_type   text NOT NULL CHECK (identifier_type IN ('phone', 'email')),
  identifier_value  text NOT NULL,
  method            text NOT NULL CHECK (method IN ('manual', 'sms_reply', 'email_click', 'oauth')),
  verified_at       timestamptz NOT NULL DEFAULT now(),
  verified_by       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  UNIQUE (org_id, contact_id, identifier_type, identifier_value)
);

-- Reverse-lookup index: contact_id → verifications (badge logic reads this
-- direction to determine "verified" state and which identifiers are verified).
CREATE INDEX IF NOT EXISTS idx_contact_verifications_contact_id
  ON public.contact_verifications (contact_id);

COMMENT ON TABLE public.contact_verifications IS
  'Audit log of contact identity verifications. One row per verified '
  '(contact, identifier) pair. UNIQUE on (org_id, contact_id, identifier_type, '
  'identifier_value) makes re-verification idempotent (23505 → no-op).';

COMMENT ON COLUMN public.contact_verifications.method IS
  'Verification mechanism (Phase 110 D-05a wide enum). Phase 110 writes '
  'only ''manual''; sms_reply/email_click/oauth are reserved for follow-up '
  'milestones and avoid future ALTER CONSTRAINT.';

-- ----- Section 2: RLS enable + 4 policies (mirrors 1057 template) -----------

ALTER TABLE public.contact_verifications ENABLE ROW LEVEL SECURITY;

-- Authenticated members can SELECT within their active org.
CREATE POLICY contact_verifications_select
  ON public.contact_verifications FOR SELECT TO authenticated
  USING (org_id = (SELECT public.get_current_org_id()));

-- Only org admins (org_members.role = 'admin') can INSERT.
CREATE POLICY contact_verifications_insert
  ON public.contact_verifications FOR INSERT TO authenticated
  WITH CHECK (
    org_id = (SELECT public.get_current_org_id())
    AND EXISTS (
      SELECT 1 FROM public.org_members
       WHERE user_id         = auth.uid()
         AND organization_id = contact_verifications.org_id
         AND role            = 'admin'
    )
  );

-- Only org admins can UPDATE (rare — re-method correction).
CREATE POLICY contact_verifications_update
  ON public.contact_verifications FOR UPDATE TO authenticated
  USING (org_id = (SELECT public.get_current_org_id()))
  WITH CHECK (
    org_id = (SELECT public.get_current_org_id())
    AND EXISTS (
      SELECT 1 FROM public.org_members
       WHERE user_id         = auth.uid()
         AND organization_id = contact_verifications.org_id
         AND role            = 'admin'
    )
  );

-- Only org admins can DELETE (revoke verification).
CREATE POLICY contact_verifications_delete
  ON public.contact_verifications FOR DELETE TO authenticated
  USING (
    org_id = (SELECT public.get_current_org_id())
    AND EXISTS (
      SELECT 1 FROM public.org_members
       WHERE user_id         = auth.uid()
         AND organization_id = contact_verifications.org_id
         AND role            = 'admin'
    )
  );
```

Apply via pooler-pg pattern (`apply-1062.mjs` based on `apply-1061.mjs`). Probe queries: insert+select (RLS hit), CASCADE on contact delete, UNIQUE collision returns 23505, INDEX exists.

### IdentityStatusBadge Component

```tsx
// src/components/contacts/identity-status-badge.tsx
'use client'

import * as React from 'react'
import Link from 'next/link'
import { CheckCircle2, AlertTriangle, Link2, Archive } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import type { ContactIdentityStatus } from '@/types/database'

interface IdentityStatusBadgeProps {
  status: ContactIdentityStatus | null
  /** Show admin-only states (archived_duplicate). Default false. */
  showAdminStates?: boolean
  /** Verified contacts can show a sub-state when at least one identifier is verified. */
  isVerified?: boolean
}

const CONFIG = {
  channel_only: {
    variant: 'info' as const,
    label: 'Channel only',
    icon: Link2,
    tooltip: 'Reachable on a messaging channel but missing phone and email.',
  },
  identified: {
    variant: 'success' as const,
    label: 'Identified',
    icon: null,
    tooltip: 'Has a phone or email but no manual verification yet.',
  },
  verified: {
    variant: 'success' as const,
    label: 'Verified',
    icon: CheckCircle2,
    tooltip: 'Phone or email verified by an admin or response.',
  },
  merge_conflict: {
    variant: 'warning' as const,
    label: 'Conflict',
    icon: AlertTriangle,
    tooltip: 'Phone matched one contact, email matched another. Resolve in /admin/contacts/conflicts.',
    href: '/admin/contacts/conflicts',
  },
  archived_duplicate: {
    variant: 'default' as const,
    label: 'Archived',
    icon: Archive,
    tooltip: 'Merged into another contact.',
  },
}

export function IdentityStatusBadge({
  status,
  showAdminStates = false,
  isVerified = false,
}: IdentityStatusBadgeProps) {
  // Defensive: null/undefined status renders nothing. Old rows pre-1056 shouldn't
  // exist (NOT NULL DEFAULT 'identified'), but be safe.
  if (!status) return null
  if (status === 'archived_duplicate' && !showAdminStates) return null

  // If status='identified' but verifications exist, present as verified.
  const effective = status === 'identified' && isVerified ? 'verified' : status
  const cfg = CONFIG[effective]
  if (!cfg) return null

  const Icon = cfg.icon
  const inner = (
    <Badge variant={cfg.variant}>
      {Icon ? <Icon className="h-3 w-3" /> : null}
      <span>{cfg.label}</span>
    </Badge>
  )
  const wrapped =
    'href' in cfg && cfg.href ? (
      <Link href={cfg.href}>{inner}</Link>
    ) : (
      inner
    )

  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>{wrapped}</TooltipTrigger>
        <TooltipContent side="bottom">{cfg.tooltip}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
```

Standalone — not embedded inside the panel. Future detail page reuses it unchanged.

### IdentityStatusBadge Insertion Point in contact-info-panel.tsx

`contact-info-panel.tsx` is already a client component. `ContactRow` has `identity_status` (Phase 105) and `merged_into_contact_id` (Phase 106), and they're surfaced on `ContactDetail` (line 205+ in actions.ts) — no extra type work needed.

Insertion point: **line 488** (immediately after the tags row, inside the header `<div className="min-w-0 flex-1">`):

```tsx
{contact.tags.length > 0 && (
  <div className="mt-2 flex flex-wrap gap-1">
    {/* existing tags */}
  </div>
)}
{/* NEW: Identity status badge */}
<div className="mt-2 flex items-center gap-2">
  <IdentityStatusBadge
    status={contact.identity_status}
    isVerified={contact.is_verified ?? false}
  />
  {contact.identity_status === 'identified' && !contact.is_verified && (
    <MarkVerifiedButton contactId={contact.id} onMarked={refresh} />
  )}
</div>
```

`contact.is_verified` is a derived prop from `getContact` — add a small `EXISTS (SELECT 1 FROM contact_verifications WHERE contact_id = $contactId)` to the existing query block in `getContact`.

Show "Mark verified" button **only** when `identity_status === 'identified'` and not yet verified — never when `channel_only` (must promote first) or `merge_conflict` (must resolve first).

### markContactVerified Server Action

```ts
// src/app/(dashboard)/contacts/actions.ts (additional export)

export interface MarkContactVerifiedInput {
  contactId: string
  identifierType: 'phone' | 'email'
  identifierValue: string
  method?: 'manual' | 'sms_reply' | 'email_click' | 'oauth'
}

export async function markContactVerified(
  input: MarkContactVerifiedInput,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await getUser()
  if (!user) return { ok: false, error: 'Not authenticated' }

  const supabase = await createClient()
  const { data: orgId } = await supabase.rpc('get_current_org_id')
  if (!orgId) return { ok: false, error: 'No organization found' }

  // assertOrgMember pattern: RLS INSERT policy already enforces org admin.
  // We rely on RLS to reject — no extra membership check.

  // Insert verification row. UNIQUE (org_id, contact_id, identifier_type,
  // identifier_value) makes idempotent: 23505 = "already verified" = success.
  const { error: insErr } = await supabase
    .from('contact_verifications')
    .insert({
      org_id: orgId,
      contact_id: input.contactId,
      identifier_type: input.identifierType,
      identifier_value: input.identifierValue,
      method: input.method ?? 'manual',
      verified_by: user.id,
    })

  if (insErr && insErr.code !== '23505') {
    return { ok: false, error: insErr.message }
  }

  // Promote 'identified' → 'verified' (D-01). Do NOT touch channel_only,
  // merge_conflict, archived_duplicate, verified. Done as a single
  // conditional UPDATE so RLS still applies.
  const { error: updErr } = await supabase
    .from('contacts')
    .update({ identity_status: 'verified' })
    .eq('id', input.contactId)
    .eq('identity_status', 'identified')

  if (updErr) {
    // The verification row is in; only the status bump failed. Log + soft fail.
    console.error(
      `[markContactVerified] status bump failed contact_id=${input.contactId}: ${updErr.message}`,
    )
  }

  revalidatePath('/contacts')
  return { ok: true }
}
```

### isBlockedEmail (Canonical Implementation)

```ts
// src/lib/contacts/blocked-emails.ts
/**
 * Hardcoded blocklist for placeholder/garbage email addresses (D-04).
 *
 * Why: legacy CSV imports + some integrations stuff `noemail@*` /
 * `test@test.com` into the email column when no real email exists. These
 * pollute the partial UNIQUE index on (org_id, email_normalized) — every
 * import collides on `noemail@example.com` because every "no email" row
 * uses the same string. Blocked emails are silently treated as null at
 * the contact-write layer; the contact is still created via phone or
 * channel identity per Phase 109's invariant.
 *
 * Patterns match against the LOWERCASED + TRIMMED email. Domain-vs-localpart
 * matching: anchor with `^` for localpart, `@` boundary for domain.
 *
 * Per-org configurability is deferred to a follow-up (D-04b).
 */

export const BLOCKED_EMAIL_PATTERNS: readonly RegExp[] = [
  /^noemail@/i,
  /^test@test\./i,
  /^none@/i,
  /^example@/i,
  /^placeholder@/i,
  /^noreply@/i,
  /@example\.(com|org)$/i,
] as const

export function isBlockedEmail(email: string | null | undefined): boolean {
  if (!email) return false
  const trimmed = email.trim().toLowerCase()
  if (!trimmed) return false
  return BLOCKED_EMAIL_PATTERNS.some((rx) => rx.test(trimmed))
}
```

**Wire points (D-04a):**

1. **Zod refine** in `src/lib/contacts/zod-schemas.ts:54-62` — extend the existing `.refine` chain on the `email` field:

```ts
email: z
  .string()
  .trim()
  .max(200)
  .optional()
  .refine((v) => !v || isValidEmail(v), 'Enter a valid email address')
  .refine((v) => !v || !isBlockedEmail(v), 'This email looks like a placeholder. Leave blank instead.'),
```

2. **`createContact`** (`src/app/(dashboard)/contacts/actions.ts:443`) — after `normaliseContactInput`, before pre-check:

```ts
if (data.email && isBlockedEmail(data.email)) {
  data = { ...data, email: null }
  // Phase 109 invariant: phone OR channel identity will carry the contact;
  // if neither exists, INSERT will fail at the trigger and we return error normally.
}
```

3. **CSV import** (`src/app/(dashboard)/contacts/actions.ts:760-763`) — after `normaliseEmail`:

```ts
const rawEmail = normaliseEmail(getField('email'))
const email = rawEmail && !isBlockedEmail(rawEmail) ? rawEmail : null
if (rawEmail && !email) {
  summary.blockedEmailCount = (summary.blockedEmailCount ?? 0) + 1
  // Don't `continue` — phone may still be valid; let the row through with null email.
}
```

4. **Webhook handlers** (`src/lib/whatsapp/process-message.ts`, `evolution/`, `telegram/`) — at the point where email is read from the payload, wrap with `isBlockedEmail` and treat as null. Don't write a blocked email into a new contact's `email` column. The phone or channel identity carries the contact (Phase 109 invariant).

### CSV Import Pre-Flight Refactor

**Current state** (`src/app/(dashboard)/contacts/actions.ts:720-735` in `importContactsCsv`):
- Fetches ALL existing `phone` + `email` from contacts (raw, un-normalized) into JS `Set`s.
- For each CSV row, normalizes via `normalisePhone`/`normaliseEmail`, then checks against the raw set. **Bug surface:** raw set contains un-normalized values like `+55 (11) 99999-0000` while normalized input is `+5511999990000`. False negatives are common.
- `summary` returns `{ inserted, skipped, errors, errorSamples }` — no conflict counter.

**Required refactor:**

```ts
// Pre-flight: load existing normalized identity values.
const { data: existing } = await supabase
  .from('contacts')
  .select('phone_e164, email_normalized, identity_status')
  .neq('identity_status', 'archived_duplicate')

const existingPhones = new Set(
  (existing ?? []).map((r) => r.phone_e164).filter((p): p is string => Boolean(p)),
)
const existingEmails = new Set(
  (existing ?? []).map((r) => r.email_normalized).filter((e): e is string => Boolean(e)),
)

// ... loop unchanged except:
// - `phone` lookup uses already-normalized `phone` value
// - `email` lookup uses already-normalized `email` value
// - blocked emails skipped per §isBlockedEmail
// - track conflictCount + blockedEmailCount in summary

interface ImportSummary {
  inserted: number
  skipped: number
  errors: number
  conflictRows: number           // NEW — D-06 surfacing
  blockedEmailCount: number      // NEW — D-04a CSV reporting
  errorSamples: string[]
}
```

**Pre-flight surfacing in dryRunImport** (`src/app/(dashboard)/contacts/import-actions.ts`): the import wizard's `DryRunResult` already has `{ wouldInsert, wouldUpdate, wouldSkip, wouldError, sampleErrors }`. Add `wouldConflict: number` and `wouldBlockedEmail: number`. The wizard preview stage (line 549-595) gets two more `<DryRunStat>` cells. Phase 110 does NOT change the batch insert shape — still 500-row chunks per existing line 815.

### Conflict Filter on /contacts

**Filter state pattern:** URL search params (`?source=whatsapp&tag=foo`). `/contacts/page.tsx` reads `sp.source`, `sp.q`, `sp.tag`, `sp.sort`, `sp.page`. Match the same pattern: add `?conflicts=1` (or extend the existing `filter` family).

**Recommended pattern** — extend `contactListFiltersSchema` in `src/lib/contacts/zod-schemas.ts:126-134`:

```ts
export const contactListFiltersSchema = z.object({
  q: z.string().trim().max(200).optional(),
  tag: z.string().trim().max(40).optional(),
  source: z.enum(CONTACT_SOURCES).optional(),
  identity_status: z.enum(['channel_only', 'identified', 'verified', 'merge_conflict']).optional(),  // NEW
  sort: z.string().default('recent'),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(25),
})
```

`getContacts` adds:
```ts
if (f.identity_status) query = query.eq('identity_status', f.identity_status)
```

`/contacts/page.tsx` adds:
```ts
const identityStatusRaw = typeof sp.identity_status === 'string' ? sp.identity_status : undefined
const identityStatus = ['merge_conflict', 'channel_only', 'identified', 'verified']
  .includes(identityStatusRaw ?? '')
  ? (identityStatusRaw as 'merge_conflict' | ...)
  : undefined
```

### Conflict Counter Query

Run once per `/contacts` page render. Add to `getContacts` return shape OR as a separate `getConflictCount(orgId)` helper:

```ts
// src/lib/contacts/server.ts (new export)
export async function getConflictCount(
  supabase: SupabaseClient<Database>,
): Promise<number> {
  const { count } = await supabase
    .from('contacts')
    .select('id', { count: 'exact', head: true })
    .eq('identity_status', 'merge_conflict')
  return count ?? 0
}
```

Called in parallel inside `ContactsBody` server component:
```ts
const [result, defsResult, conflictCount] = await Promise.all([
  getContacts(...),
  getDefinitions(...),
  getConflictCount(await createClient()),
])
```

Pass `conflictCount` down to `<ContactsTable>` and render filter chip:
- If `conflictCount === 0`: disabled chip "Conflicts: 0", no link.
- If `conflictCount > 0`: clickable chip "Conflicts: N", toggles `identity_status` URL param.
- Place next to the existing source chip in the filter row (~line 230 in `contacts-table.tsx`).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Email regex validation | New email regex | `isValidEmail` (already in `zod-schemas.ts:36`) | Already wired; consistent across forms |
| Phone normalization | New normalizer | `normalisePhone` from `zod-schemas.ts:20` | Already used everywhere; same shape as DB `phone_e164` generated column |
| Email normalization | New normalizer | `normaliseEmail` from `zod-schemas.ts:30` | Same as DB `email_normalized` generated column |
| Contact lookup by phone | Direct SELECT | `findByPhone` from `lib/contacts/server.ts:54` | Filters `archived_duplicate` (matches partial UNIQUE index predicate) |
| Contact lookup by email | Direct SELECT | `findByEmail` from `lib/contacts/server.ts:81` | Same |
| Identity-aware ID resolution | New helper | `resolveLiveContactId` from `lib/contacts/server.ts:25` | Follows merged_into chain |
| Badge primitive | New `<div>` | `Badge` from `@/components/ui/badge` | Variants: `default/primary/success/warning/danger/info/outline` already defined |
| Tooltip wrap | New popup | `Tooltip` from `@/components/ui/tooltip` (used in contact-info-panel:518-535) | Existing pattern |
| Migration apply | psql script | `apply-1062.mjs` based on `apply-1061.mjs` pooler-pg pattern | Established |
| RLS admin gating | New auth check | Mirror `contact_merge_exclusions` policy from 1057:95-105 (`EXISTS (... org_members.role='admin')`) | Same pattern, same role table |

**Key insight:** All identity-layer primitives exist. Phase 110 is wiring, not invention. The only NEW pieces are: 1 migration, 1 badge component, 1 server action, 1 blocklist file, 4 wire-ins.

## Common Pitfalls

### Pitfall 1: Defending Against NULL identity_status
**What goes wrong:** Old rows missing `identity_status` cause undefined-key crash in badge config lookup.
**Why:** Migration 1056 added `NOT NULL DEFAULT 'identified'` — every existing row was backfilled. New rows MUST have it.
**How to avoid:** Badge component returns `null` early when status is null/undefined OR when status isn't in CONFIG dict.
**Warning signs:** `Cannot read properties of undefined (reading 'variant')` in browser console.

### Pitfall 2: "Mark verified" Button Visibility
**What goes wrong:** Button shows on `channel_only` or `merge_conflict` contacts, leading to user confusion (button does nothing useful — UPDATE WHERE clause excludes these).
**Why:** D-01 says promotion only fires when `identity_status='identified'`.
**How to avoid:** Conditional render in panel: `{contact.identity_status === 'identified' && !contact.is_verified && <MarkVerifiedButton />}`. Never render for other statuses.

### Pitfall 3: CSV Import Batch Insert Shape
**What goes wrong:** Refactoring the batch insert to row-by-row to track per-row conflict count = 10x slower for 200K-row imports.
**Why:** D-06 says "Don't change batch shape, just enrich the result with conflict count".
**How to avoid:** Compute `conflictRows` count in the PRE-FLIGHT pass (loop building `toInsert` array). The batched INSERT chunks (line 815-828) stay unchanged. Conflict count is a pre-flight projection, not a post-insert measurement.

### Pitfall 4: Webhook Must Not Throw On Blocked Email
**What goes wrong:** Webhook hits a contact with `noemail@example.com`, validation throws, route returns HTTP 500. CLAUDE.md says webhooks always return HTTP 200.
**Why:** Webhooks are wrapped in try/catch by convention, but ZodError from re-using `contactSchema` would still need handling.
**How to avoid:** Webhook handlers call `isBlockedEmail(email)` BEFORE inserting; treat blocked emails as null silently. Don't go through `contactSchema`. The webhook path inserts raw (Phase 108 D-03 lookup-first pattern).

### Pitfall 5: Conflict Filter URL State Collision
**What goes wrong:** `?conflicts=1` overlaps with `?source=` and `?identity_status=` — three different ways to mean the same filter.
**Why:** Multiple iterations.
**How to avoid:** Use ONE canonical param: `?identity_status=merge_conflict`. The chip toggles this param specifically. Don't add a separate boolean `?conflicts=1` flag.

### Pitfall 6: Markverified RLS Insert Failure → Silent Bug
**What goes wrong:** Non-admin user clicks "Mark verified", RLS rejects the INSERT, the function still tries the UPDATE (which succeeds because contacts.update is broader), result: contact gets `verified` status without verification row. Audit trail broken.
**Why:** Two separate operations in `markContactVerified` — RLS only protects the first.
**How to avoid:** UPDATE must come AFTER successful INSERT (or 23505 idempotent). If `insErr.code !== '23505'` → return error and skip UPDATE. (See server-action code above — already structured this way.)

### Pitfall 7: is_verified Computation Cost
**What goes wrong:** Adding `EXISTS (SELECT 1 FROM contact_verifications WHERE contact_id = $id)` to the existing `getContact` query block fans out. For list pages, computing this per-row in JS is O(N) extra queries.
**Why:** Naive implementation.
**How to avoid:** For the panel (single contact), do `EXISTS` once. For the LIST page (`/contacts`), DO NOT show "verified" sub-state per row — just `identity_status` (already on the row). If list-page verified is needed later: SQL view joining `LEFT JOIN LATERAL (SELECT 1 FROM contact_verifications WHERE contact_id = c.id LIMIT 1) v ON true`.

### Pitfall 8: Zod Refine Order
**What goes wrong:** Putting `isBlockedEmail` refine BEFORE `isValidEmail` refine = blocked-pattern check on invalid emails.
**Why:** Chain order matters in zod.
**How to avoid:** `isValidEmail` first, then `isBlockedEmail`. Invalid emails fail fast with clear message; only valid-shape emails get the blocklist check.

### Pitfall 9: Migration 1062 + Phase 109 Trigger
**What goes wrong:** Migration ordering — does `contact_verifications` interact with the Phase 109 identity invariant trigger? **No**: triggers fire on `contacts` and `contact_channel_identities`. `contact_verifications` is unrelated to the invariant. No coordination needed.
**How to avoid:** Apply 1062 standalone. No DEFERRABLE concerns.

### Pitfall 10: Conflict Filter Counter Staleness
**What goes wrong:** Admin merges a conflict cluster on `/admin/contacts/conflicts`, count on `/contacts` filter chip still shows old number until manual refresh.
**Why:** Server components cache; `revalidatePath('/contacts')` from the merge action would address this.
**How to avoid:** `mergeContacts` already calls `revalidatePath('/admin/contacts/conflicts')` (line 38 of conflicts.ts). Add `revalidatePath('/contacts')` alongside so the conflict counter updates.

## Runtime State Inventory

> Phase 110 introduces a NEW table and NEW server action. Not a rename/refactor/migration phase. No runtime state inventory needed.

**Skipped (not a rename/refactor/migration phase).**

## Environment Availability

Phase 110 is pure app code + 1 migration. External dependencies already in use:

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Supabase prod DB | Migration 1062 apply | ✓ | (in use) | — |
| Node.js | Migration apply script | ✓ | (in use) | — |
| `pg` (pooler) | apply-1062.mjs | ✓ | (used in 1057-1061 apply) | — |
| Next.js dev server | Manual UI testing | ✓ | 16 | — |
| Vitest | Test runner | ✓ | (existing) | — |

**Missing dependencies with no fallback:** None.
**Missing dependencies with fallback:** None.

## Code Examples

### markContactVerified Caller in contact-info-panel.tsx

```tsx
function MarkVerifiedButton({
  contactId,
  identifierType,
  identifierValue,
  onMarked,
}: {
  contactId: string
  identifierType: 'phone' | 'email'
  identifierValue: string
  onMarked: () => void
}) {
  const [saving, setSaving] = React.useState(false)
  async function handleClick() {
    setSaving(true)
    const res = await markContactVerified({
      contactId,
      identifierType,
      identifierValue,
    })
    setSaving(false)
    if (!res.ok) {
      toast.error(res.error)
      return
    }
    toast.success('Contact verified')
    onMarked()
  }
  return (
    <Button size="sm" variant="ghost" onClick={handleClick} disabled={saving}>
      <CheckCircle2 className="h-3 w-3" />
      Mark verified
    </Button>
  )
}
```

Choose `identifierType` based on what's present: prefer phone, fall back to email. The button caller passes `contact.phone ?? contact.email` and the matching type.

### Migration Apply Script Skeleton (apply-1062.mjs)

Mirror `apply-1061.mjs`:
```js
import pg from 'pg'
import { readFileSync } from 'node:fs'

const url = process.env.DATABASE_URL
if (!url) throw new Error('DATABASE_URL required')
const sql = readFileSync('supabase/migrations/1062_contact_verifications.sql', 'utf8')

const client = new pg.Client({ connectionString: url })
await client.connect()
try {
  await client.query('BEGIN')
  await client.query(sql)
  // Probes:
  const { rows: tbl } = await client.query(
    `SELECT 1 FROM information_schema.tables WHERE table_name='contact_verifications'`,
  )
  if (!tbl.length) throw new Error('Probe failed: table missing')
  const { rows: idx } = await client.query(
    `SELECT 1 FROM pg_indexes WHERE indexname='idx_contact_verifications_contact_id'`,
  )
  if (!idx.length) throw new Error('Probe failed: index missing')
  await client.query('COMMIT')
  console.log('migration 1062 applied')
} catch (e) {
  await client.query('ROLLBACK')
  throw e
} finally {
  await client.end()
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Raw `phone`/`email` columns for dedup | `phone_e164`/`email_normalized` generated columns | Phase 105 (1056) | CSV import must switch lookup |
| Validation only in forms | Validation in form + DB trigger + helpers | Phase 109 (1061) | Defense in depth for blocked-email rejection |
| Identity is implicit | `identity_status` 5-state enum | Phase 105/106 | Badge UI is now first-class |
| `contacts.source` text column | `contact_channel_identities` table | Phase 108 | DEPRECATED comment lives; drop is Phase 110+ (NOT this phase) |

**Deprecated/outdated:**
- Raw `contacts.phone`/`contacts.email` for lookup (use normalized columns).
- `existingPhones`/`existingEmails` Sets in CSV import based on un-normalized values (current `actions.ts:725-734`).

## Open Questions

1. **Should the conflict chip on /contacts disappear when count=0 or stay disabled?**
   - What we know: D-08 says "chip is disabled with count 0 (no flash)".
   - What's unclear: "no flash" means render-then-disable or simply always render disabled.
   - Recommendation: Render disabled chip always; on count=0 → opacity-50 + cursor-not-allowed. No layout shift.

2. **Should `is_verified` derive from contact_verifications row OR from a denormalized contacts.verified flag?**
   - What we know: D-05 spec lists only the audit table, no new contacts column.
   - What's unclear: derived state vs. denormalized for read perf.
   - Recommendation: Derive (status='verified' = "has at least one verification row + status='identified' bumped to 'verified'"). Single source of truth. If perf becomes an issue, add denormalized `contacts.verified_at` later.

3. **Where should the conflict counter query live?**
   - Options: (a) extend `getContacts` return shape, (b) new helper `getConflictCount`, (c) inline in the page server component.
   - Recommendation: New helper `getConflictCount` in `src/lib/contacts/server.ts` (mirrors `findByPhone`/`findByEmail` co-location). Called in parallel inside `ContactsBody`.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest (existing in `tests/`) |
| Config file | `vitest.config.ts` (existing) |
| Quick run command | `npx vitest run tests/contacts-blocked-emails.test.ts` |
| Full suite command | `npm run lint && npm run build && npx vitest run` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|--------------|
| CID-14 | `contact_verifications` INSERT+SELECT+RLS+CASCADE+UNIQUE | integration (pg client) | `npx vitest run tests/contact-verifications.test.ts` | ❌ Wave 0 |
| CID-14 | `markContactVerified` promotes 'identified' → 'verified' (idempotent on duplicate) | integration | same file | ❌ Wave 0 |
| CID-14 | `markContactVerified` does NOT bump 'channel_only', 'merge_conflict', 'archived_duplicate' | integration | same file | ❌ Wave 0 |
| CID-15 | Conflict filter URL param `?identity_status=merge_conflict` filters correctly | manual (browser smoke) | `npm run dev` + visit /contacts | manual-only |
| CID-15 | Conflict counter renders accurate count and disables at 0 | manual | same | manual-only |
| CID-15 | Badge renders correct variant per status (5 states) | manual | view contact-info-panel | manual-only |
| CID-16 | `isBlockedEmail` matches D-04 patterns, case-insensitive, whitespace-tolerant | unit | `npx vitest run tests/contacts-blocked-emails.test.ts` | ❌ Wave 0 |
| CID-16 | CSV import pre-flight returns `conflictRows` + `blockedEmailCount` | integration | `npx vitest run tests/contacts-csv-import.test.ts` | ❌ Wave 0 |
| CID-16 | Zod refine rejects blocked emails | unit | `npx vitest run tests/contacts-zod-schema.test.ts` | partial (zod schema test may exist) |
| All | `npm run build` exits 0 (TS types updated for contact_verifications) | build | `npm run build` | ✓ existing |

### Sampling Rate
- **Per task commit:** `npx vitest run tests/contacts-blocked-emails.test.ts` (pure unit, fast)
- **Per wave merge:** `npm run lint && npm run build && npx vitest run tests/contact-verifications.test.ts tests/contacts-blocked-emails.test.ts tests/contacts-csv-import.test.ts`
- **Phase gate:** Full suite green + manual UI smoke (badge / filter / mark-verified button visible & functional).

### Wave 0 Gaps
- [ ] `tests/contacts-blocked-emails.test.ts` — unit tests for `isBlockedEmail` (covers CID-16). Patterns to test:
  - All 7 patterns match expected localparts/domains
  - Case insensitivity: `NOEMAIL@FOO.COM`, `Test@Test.COM`
  - Whitespace trim: `'  noemail@foo  '`
  - Negative: `real.user@gmail.com`, `noemail.fake@gmail.com` (substring match must NOT trigger — only `^noemail@`)
  - Null/empty: `null`, `undefined`, `''` → false
- [ ] `tests/contact-verifications.test.ts` — pg client integration (mirror `tests/contact-identity-trigger.test.ts` shape). Covers CID-14:
  - INSERT + RLS visibility within org
  - CASCADE on contact delete (verification row gone)
  - UNIQUE (org_id, contact_id, identifier_type, identifier_value) collision returns 23505 (idempotent)
  - `markContactVerified` flow: 'identified' → 'verified' bump
  - Status guard: `markContactVerified` on 'channel_only' does not bump (UPDATE WHERE no-op)
- [ ] `tests/contacts-csv-import.test.ts` — extend or new file. Covers CID-16:
  - Pre-flight reports `conflictRows` when phone matches existing live contact
  - Pre-flight reports `blockedEmailCount` when CSV row has `noemail@*`
  - Batch insert chunk size unchanged
- [ ] Manual UI smoke checklist for badge / filter / mark-verified — captured in 110-VALIDATION-REPORT.md template.

## Sources

### Primary (HIGH confidence)
- `supabase/migrations/1057_contact_merge_tool.sql` (lines 75-105) — RLS template with `org_members.role='admin'` gating, mirrored in 1062.
- `supabase/migrations/1060_contact_channel_identities.sql` (lines 67-90) — 4-policy RLS pattern.
- `src/lib/contacts/zod-schemas.ts` (lines 20-80) — `normalisePhone`, `normaliseEmail`, `isValidEmail`, `contactSchema.refine`.
- `src/lib/contacts/server.ts` (lines 54-202) — `findByPhone`, `findByEmail`, `findByChannelIdentity`, `attachChannelIdentity`, `resolveLiveContactId`.
- `src/app/(dashboard)/contacts/actions.ts` (lines 411-557 createContact, 680-832 importContactsCsv).
- `src/components/contacts/import-wizard-dialog.tsx` (lines 76-83 DryRunResult, 549-595 preview stage).
- `src/components/chat/contact-info-panel.tsx` (line 488 insertion point, 552-559 MergedBanner precedent).
- `src/app/(dashboard)/contacts/page.tsx` (lines 9-49 search-param filter pattern).
- `src/components/ui/badge.tsx` (lines 6-43 variants: default/primary/success/warning/danger/info/outline).
- `src/app/(admin)/admin/contacts/conflicts/_actions/conflicts.ts` (lines 7-13 `assertAdmin`).
- Phase 105-109 CONTEXT.md (all 5 files) for binding identity model.

### Secondary (MEDIUM confidence)
- CLAUDE.md (project conventions: build verification, RLS, sonner, runtime split).

### Tertiary (LOW confidence)
- None. All claims verified against repo files or migration source.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all primitives already in repo and used.
- Architecture: HIGH — migration mirror, server-action shape, and badge component are direct extensions of existing patterns.
- Pitfalls: HIGH — derived from cross-referencing CONTEXT.md decisions with current code; webhook HTTP-200 rule from CLAUDE.md.
- CSV import refactor: HIGH — current code path read and gap identified at lines 720-735.
- Conflict filter URL state: HIGH — matched existing `?source=` pattern from `page.tsx:20-23`.

**Research date:** 2026-05-26
**Valid until:** 2026-06-25 (30 days; identity workstream is stable)
