---
plan: 82-01
status: complete
completed_at: "2026-05-19"
requirements_satisfied:
  - ADM-01
  - ADM-05
  - ADM-06
---

# Summary: 82-01 — Admin layout, email gate, sidebar, migration 069

## What was done

**Migration 069** (`supabase/migrations/069_org_settings_jsonb.sql`): adds `settings jsonb NOT NULL DEFAULT '{}'` to `organizations`. Pending `npx supabase db push` from local machine (remote DB unreachable in CI environment).

**`src/types/database.ts`**: `settings: Json` added to `organizations.Row`; `settings?: Json` added to `organizations.Insert` and `organizations.Update`.

**`src/app/(admin)/layout.tsx`**: async server component with email gate — unauthenticated users redirect to `/login`, non-admin emails redirect to `/dashboard`. Renders dark admin shell (`#0A0A0B` bg) with fixed header showing "SUPER ADMIN" gradient badge and user email.

**`src/app/(admin)/admin/page.tsx`**: root `/admin` redirect to `/admin/orgs`.

**`src/components/admin/admin-sidebar.tsx`**: client component with `usePathname`-driven active state. Sidebar bg `#111113`, red accent brand tint, active nav item `bg-red-500/10 text-red-400 border-l-2 border-red-500`. No dashboard components imported.

## Verification

- `npm run build` exits 0 ✅
- Routes `/admin` and `/admin/orgs` appear in build output ✅
- `PLATFORM_ADMIN_EMAIL` used in layout gate (never hardcoded) ✅
- AdminSidebar contains `ShieldCheck`, `Building2`, `bg-red-500/10` ✅
