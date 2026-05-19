# Phase 82: SUPER-ADMIN-PANEL - Research

**Researched:** 2026-05-18
**Domain:** Next.js App Router route groups, Supabase service-role client, admin access control, shadcn/ui
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- Route group `(admin)/` with its own layout at `src/app/(admin)/admin/`
- Auth gate: `getUser()` + email check in layout — redirect to `/dashboard` if email !== `skale.club@gmail.com`
- Use `createClient()` (normal authenticated client) in admin **layout** for auth check only
- Server actions use `createServiceRoleClient()` from `@/lib/supabase/admin` for cross-org queries
- Sidebar: simple, dedicated — no org-switcher, no dashboard components
- Palette: slate/zinc dark with red/orange accent — forced dark mode via `class="dark"` on layout
- Metrics per org: contacts count, calls count, conversations count, members count + created_at
- Feature flags persisted in `settings jsonb` column on `organizations` table — **requires a new migration** (column does not yet exist)
- No impersonation, no audit log, no real-time, no limites numéricos in this phase

### Claude's Discretion

- Naming of feature flags (decided: `ai_calling_enabled`, `bulk_import_enabled`, `advanced_pipeline_enabled`)
- Internal organization of admin server actions
- Styling details of admin sidebar within the red/slate palette

### Deferred Ideas (OUT OF SCOPE)

- Org impersonation
- Audit log of changes
- Numeric limits per org (max contacts, max calls)
- Real-time updates
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| ADM-01 | Acesso restrito — somente `skale.club@gmail.com` pode acessar `/admin/*` | Auth gate pattern in layout, `PLATFORM_ADMIN_EMAIL` env var pattern confirmed |
| ADM-02 | Listagem de todas as organizações com métricas de uso | Service role client + cross-table COUNT queries, confirmed table names |
| ADM-03 | Detalhes por organização: membros, configurações, status | `org_members` + organizations data, service role bypass RLS |
| ADM-04 | Ajuste de preferências e features por organização | `settings jsonb` column needs migration 069; update via service role |
| ADM-05 | Visual distinto do dashboard de cliente — contexto admin claro | Forced dark mode, red/orange accent — isolated from dashboard layout |
| ADM-06 | Navegação e layout dedicados para o painel admin | New `(admin)` route group with own layout, sidebar component |
</phase_requirements>

---

## Summary

Phase 82 builds a super-admin panel at `/admin/*`, isolated in a new `(admin)` route group that sits alongside the existing `(dashboard)` group. The implementation follows an established pattern in the codebase: auth gate in layout (`getUser()` + email check), then server actions using `createServiceRoleClient()` (already in `src/lib/supabase/admin.ts`) for cross-org queries that bypass RLS.

The single missing piece is the `settings jsonb` column on the `organizations` table — it is referenced throughout CONTEXT.md and UI-SPEC.md as the persistence target for feature flags, but it does not exist in any migration (1–068) and is absent from `src/types/database.ts`. A migration `069_org_settings_jsonb.sql` must be created as the first task of this phase.

All UI components are already installed (Switch, Card, Badge, Table, Button, Separator, Skeleton, Input per `components.json`). The admin email is controlled by `PLATFORM_ADMIN_EMAIL` env var — the codebase already uses this variable in the platform settings page; the admin panel must do the same.

**Primary recommendation:** Create `(admin)` route group → write migration 069 for `settings jsonb` → implement layout with email gate → build server actions with service role → build pages using verified patterns from `(dashboard)` codebase.

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Next.js App Router | 16 (project) | Route groups, server components, server actions | Already in use — no choice |
| `@supabase/ssr` | project version | Authenticated client via cookies | Established pattern in `src/lib/supabase/server.ts` |
| `@supabase/supabase-js` | project version | Service-role client for RLS bypass | Already in `src/lib/supabase/admin.ts` |
| shadcn/ui | installed | Table, Card, Switch, Badge, Button, Skeleton, Input | Already installed per `components.json` |
| lucide-react | installed | Icons: ShieldCheck, Building2, Users, Phone, etc. | Project standard |
| sonner | installed | Toast notifications for save/error feedback | Project standard |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `react-hook-form` + `zod` | installed | Form validation | Not needed here — admin saves are simple server actions, no complex forms |
| `next/navigation` redirect | built-in | Auth gate redirect | Used in every layout and page guard |

### Installation

No new packages required — all dependencies already in `node_modules`.

---

## Architecture Patterns

### Recommended Project Structure

```
src/app/(admin)/
  layout.tsx                    # Email gate: getUser() + redirect if not admin
  admin/
    page.tsx                    # Immediate redirect to /admin/orgs
    orgs/
      page.tsx                  # Organizations list page (server component)
      [orgId]/
        page.tsx                # Org detail page (server component)
src/app/(admin)/admin/
  _actions/
    get-all-orgs.ts             # Service-role: list all orgs + metrics
    get-org-detail.ts           # Service-role: org members + org row
    update-org-settings.ts      # Service-role: JSONB patch for feature flags
src/components/admin/
  admin-sidebar.tsx             # Dedicated sidebar (no OrgSwitcher)
  orgs-table.tsx                # Client component: sortable/searchable table
  feature-flags-form.tsx        # Client component: Switch list + save
supabase/migrations/
  069_org_settings_jsonb.sql    # ADD COLUMN settings jsonb to organizations
```

### Pattern 1: Admin Layout Auth Gate

**What:** Server component layout verifies email before rendering children.
**When to use:** All admin routes — the gate lives here so no page forgets to check.

```typescript
// src/app/(admin)/layout.tsx
import { redirect } from 'next/navigation'
import { getUser } from '@/lib/supabase/server'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await getUser()
  if (!user) redirect('/login')
  if (user.email !== process.env.PLATFORM_ADMIN_EMAIL) redirect('/dashboard')
  // render admin shell (sidebar + header + children)
}
```

Source: Confirmed pattern from `src/app/(dashboard)/settings/platform/page.tsx` and `src/app/(dashboard)/layout.tsx`.

### Pattern 2: Service Role Client for Cross-Org Queries

**What:** Import `createServiceRoleClient` from `@/lib/supabase/admin` in server actions to query all orgs bypassing RLS.
**When to use:** Any admin server action that reads or writes data across multiple orgs.

```typescript
// src/app/(admin)/admin/_actions/get-all-orgs.ts
'use server'
import { createServiceRoleClient } from '@/lib/supabase/admin'

export async function getAllOrgs() {
  const admin = createServiceRoleClient()
  const { data, error } = await admin
    .from('organizations')
    .select(`
      id, name, slug, created_at, is_active, settings,
      org_members(count),
      contacts(count),
      calls(count),
      conversations(count)
    `)
    .order('created_at', { ascending: false })
  if (error) throw error
  return data
}
```

Source: `src/lib/supabase/admin.ts` (verified), cross-org pattern from `src/app/(dashboard)/agents/actions.ts` lines 408–412.

**Note on Supabase count syntax:** `relation(count)` is the correct PostgREST aggregate syntax. The count is returned as `[{ count: N }]` — must be accessed as `org_members[0]?.count ?? 0`.

**Note on contacts/calls/conversations FK naming:** `contacts` uses `org_id`, `calls` uses `organization_id`, `conversations` uses `org_id`. The service role join must match the actual FK column names. Individual COUNT queries per org may be more reliable than embedded aggregate select for cross-table counts.

### Pattern 3: JSONB Settings Update

**What:** Patch a specific key inside the `settings` jsonb column without overwriting other keys.
**When to use:** Saving feature flags — must merge, not replace.

```typescript
// Merge pattern using jsonb || operator via raw SQL, or:
const { error } = await admin
  .from('organizations')
  .update({
    settings: {
      ...currentSettings,
      feature_flags: {
        ai_calling_enabled: flagValues.ai_calling_enabled,
        bulk_import_enabled: flagValues.bulk_import_enabled,
        advanced_pipeline_enabled: flagValues.advanced_pipeline_enabled,
      },
      admin_notes: noteValues,
    }
  })
  .eq('id', orgId)
```

Source: Supabase JSONB update pattern — standard PostgREST behavior.

### Pattern 4: Forced Dark Mode on Route Group Layout

**What:** Apply `dark` class on the root element in the admin layout so Tailwind dark variants activate unconditionally.
**When to use:** Admin panel must always be dark regardless of system preference.

```tsx
return (
  <div className="dark min-h-screen bg-[#0A0A0B] text-[#FAFAFA]">
    <AdminSidebar />
    <main>{children}</main>
  </div>
)
```

Source: UI-SPEC.md — "Apply `class='dark'` on the `(admin)` layout `<html>` or wrapping element."

**Note:** The root `<html>` already receives a `dark`/`light` class from the ThemeProvider in the root layout. Applying `dark` on an inner wrapper is sufficient for Tailwind variants on all admin child elements.

### Anti-Patterns to Avoid

- **Using `createClient()` (RLS-scoped) for admin queries:** Will return only the admin user's own org, not all orgs. Must use `createServiceRoleClient()`.
- **Importing `createServiceRoleClient` in client components:** Admin client uses service role key — must only be called in `'use server'` actions or server-only modules.
- **Skipping the email gate in individual pages:** Only the layout gate is needed — pages under `(admin)/` are protected by the layout. Adding redundant checks in each page is unnecessary but harmless.
- **Replacing entire `settings` jsonb on update:** Use merge (`{ ...existing, feature_flags: newFlags }`) to avoid wiping other fields stored in settings.
- **Using `organization_members` as the table name:** The actual table is `org_members` (confirmed in `database.ts` and migrations). CONTEXT.md mentions `organization_members` — that is the logical name but the actual table is `org_members`.

---

## Critical Finding: `settings` JSONB Column Does Not Exist

**Status:** BLOCKING — requires migration before any feature flags UI can work.

The `organizations` table was created in migration 001 with: `id`, `name`, `slug`, `is_active`, `created_at`, `updated_at`. Subsequent migrations added `widget_token`, `widget_display_name`, `widget_primary_color`, `daily_cost_cap_usd_override`, `delegation_visibility`, `logo_url`, `accent_color`, `brand_name` — but no `settings jsonb` column exists anywhere in migrations 001–068.

`src/types/database.ts` `organizations.Row` does not include `settings`. Writing to `settings` without the migration will produce a TypeScript type error and a Supabase runtime error.

**Required migration (must be Wave 0 / Task 1):**

```sql
-- supabase/migrations/069_org_settings_jsonb.sql
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS settings jsonb NOT NULL DEFAULT '{}';
```

After applying: regenerate or manually update `src/types/database.ts` to add `settings: Json` to `organizations.Row`, `organizations.Insert`, and `organizations.Update`.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Service-role client setup | Custom Supabase client factory | `createServiceRoleClient()` from `@/lib/supabase/admin` | Already exists, typed with `Database`, `persistSession: false` set correctly |
| Auth guard | Custom middleware or HOC | `getUser()` from `@/lib/supabase/server` + redirect | `cache()` deduplication already built in — one network call per render tree |
| Cross-org aggregate queries | Manual loop with per-org queries | PostgREST aggregate selects or parallel COUNT queries | N+1 query problem if done in a loop |
| Toast notifications | Custom toast UI | `sonner` (already installed) | Project standard, 0 setup needed |
| Table sort/search | Custom sort algorithm | Client-side state with `useState` + `Array.sort` | The orgs table is small (low N), no pagination needed |

**Key insight:** The admin service client and auth patterns are already established — this phase is 100% assembly of existing pieces, not new infrastructure.

---

## Common Pitfalls

### Pitfall 1: Wrong Table/Column Names for Metrics

**What goes wrong:** Querying `organization_members` (doesn't exist) instead of `org_members`; querying contacts joined by `organization_id` instead of `org_id`.
**Why it happens:** CONTEXT.md and UI-SPEC.md use logical names that don't match actual DB schema.
**How to avoid:** Cross-reference `src/types/database.ts` for every table and FK column name before writing queries.
**Warning signs:** TypeScript type errors on `.from()` calls; Supabase runtime 400 errors.

**Confirmed column/table mapping for metrics:**

| Metric | Table | FK to organizations |
|--------|-------|---------------------|
| Members | `org_members` | `organization_id` |
| Contacts | `contacts` | `org_id` |
| Calls | `calls` | `organization_id` |
| Conversations | `conversations` | `org_id` |

### Pitfall 2: `settings` Column Missing Until Migration Runs

**What goes wrong:** Writing `update({ settings: {...} })` before migration 069 is applied — Supabase returns a 400/404, TypeScript complains.
**Why it happens:** The column was referenced in planning docs as if it already existed, but it does not.
**How to avoid:** Apply migration 069 and update `database.ts` before writing any feature flags logic.
**Warning signs:** TypeScript error: "Property 'settings' does not exist on type '...organizations.Update'".

### Pitfall 3: Dark Mode Leaking Into Dashboard

**What:** Applying `dark` class too broadly (on `<html>`) from the admin layout when the root layout also sets theme.
**Why:** The root layout's `ThemeProvider` also sets the `dark`/`light` class on `<html>`. If both layouts try to control `<html>`, conflicts occur.
**How to avoid:** Apply `dark` on an inner `<div>` wrapper inside the admin layout, not on `<html>`. This scopes Tailwind dark variants to admin elements only.
**Warning signs:** Dashboard pages render in forced dark mode after visiting admin panel.

### Pitfall 4: Using `process.env.PLATFORM_ADMIN_EMAIL` vs Hardcoded String

**What goes wrong:** Hardcoding `'skale.club@gmail.com'` in the admin layout instead of reading from `PLATFORM_ADMIN_EMAIL`.
**Why it's bad:** The env var approach is already established in `platform/page.tsx` and `platform/actions.ts`; the dashboard layout already checks `isPlatformAdmin = user.email === process.env.PLATFORM_ADMIN_EMAIL`. Consistency matters.
**How to avoid:** Always `process.env.PLATFORM_ADMIN_EMAIL` — never hardcode the email string.

### Pitfall 5: Supabase Embedded Count Returns Array, Not Number

**What goes wrong:** `org.org_members[0]?.count` returns `"3"` (string) not `3` (number). Supabase returns count as a string in aggregate queries.
**How to avoid:** Always `Number(org.org_members[0]?.count ?? 0)` or `parseInt(...)` when using PostgREST aggregate counts.

---

## Code Examples

### Admin Layout (complete shell)

```typescript
// src/app/(admin)/layout.tsx
import { redirect } from 'next/navigation'
import { getUser } from '@/lib/supabase/server'
import { AdminSidebar } from '@/components/admin/admin-sidebar'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await getUser()
  if (!user) redirect('/login')
  if (user.email !== process.env.PLATFORM_ADMIN_EMAIL) redirect('/dashboard')

  return (
    <div className="dark flex min-h-screen bg-[#0A0A0B] text-[#FAFAFA]">
      <AdminSidebar />
      <div className="flex flex-1 flex-col">
        {/* Header + content area */}
        {children}
      </div>
    </div>
  )
}
```

### Service Role Admin Action (get all orgs with metrics)

```typescript
// src/app/(admin)/admin/_actions/get-all-orgs.ts
'use server'
import { createServiceRoleClient } from '@/lib/supabase/admin'

export type OrgRow = {
  id: string
  name: string
  slug: string
  created_at: string
  is_active: boolean
  settings: Record<string, unknown>
  members_count: number
  contacts_count: number
  calls_count: number
  conversations_count: number
}

export async function getAllOrgs(): Promise<OrgRow[]> {
  const admin = createServiceRoleClient()

  const { data: orgs, error } = await admin
    .from('organizations')
    .select('id, name, slug, created_at, is_active, settings')
    .order('created_at', { ascending: false })
  if (error) throw error

  // Parallel COUNT queries — avoids N+1 and avoids complex nested aggregate
  const withMetrics = await Promise.all(
    orgs.map(async (org) => {
      const [members, contacts, calls, conversations] = await Promise.all([
        admin.from('org_members').select('*', { count: 'exact', head: true }).eq('organization_id', org.id),
        admin.from('contacts').select('*', { count: 'exact', head: true }).eq('org_id', org.id),
        admin.from('calls').select('*', { count: 'exact', head: true }).eq('organization_id', org.id),
        admin.from('conversations').select('*', { count: 'exact', head: true }).eq('org_id', org.id),
      ])
      return {
        ...org,
        settings: (org.settings as Record<string, unknown>) ?? {},
        members_count: members.count ?? 0,
        contacts_count: contacts.count ?? 0,
        calls_count: calls.count ?? 0,
        conversations_count: conversations.count ?? 0,
      }
    })
  )
  return withMetrics
}
```

Source: `createServiceRoleClient` from `src/lib/supabase/admin.ts` (verified). Count pattern with `{ count: 'exact', head: true }` is the correct Supabase JS v2 pattern.

### Feature Flags Update Action

```typescript
// src/app/(admin)/admin/_actions/update-org-settings.ts
'use server'
import { getUser } from '@/lib/supabase/server'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import { redirect } from 'next/navigation'

export async function updateOrgSettings(
  orgId: string,
  featureFlags: Record<string, boolean>,
  adminNotes: Record<string, string>
): Promise<{ error?: string }> {
  const user = await getUser()
  if (!user || user.email !== process.env.PLATFORM_ADMIN_EMAIL) redirect('/dashboard')

  const admin = createServiceRoleClient()

  // Fetch current settings to merge
  const { data: org } = await admin
    .from('organizations')
    .select('settings')
    .eq('id', orgId)
    .single()

  const currentSettings = (org?.settings as Record<string, unknown>) ?? {}

  const { error } = await admin
    .from('organizations')
    .update({
      settings: {
        ...currentSettings,
        feature_flags: featureFlags,
        admin_notes: adminNotes,
      }
    })
    .eq('id', orgId)

  if (error) return { error: error.message }
  return {}
}
```

---

## Migration Required (Wave 0)

```sql
-- supabase/migrations/069_org_settings_jsonb.sql
-- Add settings JSONB column to organizations for feature flags and admin notes.
-- Default '{}' ensures existing rows are valid immediately.
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS settings jsonb NOT NULL DEFAULT '{}';
```

After applying, add to `src/types/database.ts` `organizations` table type:
- `Row`: `settings: Json`
- `Insert`: `settings?: Json`
- `Update`: `settings?: Json`

---

## Environment Availability

Step 2.6: SKIPPED — this phase is purely code/config/migration changes within the existing project. No new external dependencies. `PLATFORM_ADMIN_EMAIL` and `SUPABASE_SERVICE_ROLE_KEY` are already in use by other features, confirming they are set in the environment.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest (confirmed — `tests/` directory exists) |
| Config file | `vitest.config.*` (check root) |
| Quick run command | `npx vitest run` |
| Full suite command | `npx vitest run` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | Notes |
|--------|----------|-----------|-------------------|-------|
| ADM-01 | Non-admin email → redirect to /dashboard | manual-only | — | Requires browser session; layout redirect not unit-testable without full Next.js runtime |
| ADM-02 | `getAllOrgs()` returns all orgs with metric counts | unit | `npx vitest run tests/admin/get-all-orgs.test.ts` | Stub Supabase admin client |
| ADM-03 | `getOrgDetail()` returns org + members | unit | `npx vitest run tests/admin/get-org-detail.test.ts` | Stub admin client |
| ADM-04 | `updateOrgSettings()` merges feature flags without wiping other keys | unit | `npx vitest run tests/admin/update-org-settings.test.ts` | Verify merge behavior |
| ADM-05 | Visual distinction (forced dark, red accent) | manual-only | — | CSS visual test — manual review |
| ADM-06 | `/admin/orgs` page renders without errors | build | `npm run build` | TypeScript + build validates page shape |

### Sampling Rate

- Per task commit: `npm run build` (catches type errors)
- Per wave merge: `npx vitest run`
- Phase gate: build exits 0 + manual browser review of admin access control

### Wave 0 Gaps

- [ ] `tests/admin/get-all-orgs.test.ts` — covers ADM-02
- [ ] `tests/admin/get-org-detail.test.ts` — covers ADM-03
- [ ] `tests/admin/update-org-settings.test.ts` — covers ADM-04 merge behavior

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Middleware-based auth guard | Layout-level `getUser()` + redirect | Early in this project | No middleware needed; matches project convention |
| Per-page auth checks | Single layout check + route group isolation | Already established | Pages under `(admin)/` are automatically gated |

---

## Open Questions

1. **Members table: email address for display**
   - What we know: `org_members` has `user_id` (UUID) but no `email` column. Email lives in `auth.users`.
   - What's unclear: To show member emails in the org detail view, a join to `auth.users` is needed. This requires the service role client (RLS blocks `auth.users` for regular clients).
   - Recommendation: Use `admin.auth.admin.listUsers()` or join via service role. The `agents/actions.ts` file already does this pattern (line 408+). Use the same approach.

2. **`settings` column RLS on UPDATE**
   - What we know: The current `org_update` RLS policy scopes updates to `get_current_org_id()`. Admin updates via service role bypass RLS entirely.
   - What's unclear: Whether a future non-admin user could accidentally call the update action.
   - Recommendation: The server action already gates on `PLATFORM_ADMIN_EMAIL` before calling service role — this double-check is sufficient. Documented in the action code examples above.

---

## Sources

### Primary (HIGH confidence)

- `src/lib/supabase/admin.ts` — `createServiceRoleClient()` implementation verified
- `src/lib/supabase/server.ts` — `createClient()` and `getUser()` cache pattern verified
- `src/app/(dashboard)/layout.tsx` — auth gate pattern + `PLATFORM_ADMIN_EMAIL` usage verified
- `src/app/(dashboard)/settings/platform/page.tsx` + `actions.ts` — admin email check pattern verified
- `src/types/database.ts` — full organizations table schema (no `settings` column confirmed)
- `supabase/migrations/001_foundation.sql` — `organizations` table definition + RLS policies verified
- `supabase/migrations/001_foundation.sql` through `068_notes.sql` — full scan for `settings jsonb` column: NOT FOUND
- `82-UI-SPEC.md` — complete visual + interaction contract
- `82-CONTEXT.md` — locked implementation decisions

### Secondary (MEDIUM confidence)

- Supabase JS v2 `{ count: 'exact', head: true }` pattern — standard documented behavior, used in project

---

## Metadata

**Confidence breakdown:**

- Standard stack: HIGH — all packages are already in the project, verified by direct file inspection
- Architecture: HIGH — patterns are directly copied from established project code
- Critical finding (missing settings column): HIGH — exhaustive scan of all 68 migrations found zero occurrences
- Pitfalls: HIGH — all based on direct code reading, not speculation
- Test patterns: MEDIUM — Vitest presence confirmed but specific test structure for admin actions is new

**Research date:** 2026-05-18
**Valid until:** 2026-06-18 (stable stack)
