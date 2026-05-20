---
phase: 260520-kc1
plan: 01
subsystem: dashboard-ui
tags: [refactor, ui, breadcrumb, dashboard]
requires: []
provides:
  - "Dashboard pages with breadcrumb as the single source of page identity"
affects:
  - "All dashboard list pages — vertical space reclaimed, no duplicate title"
tech-stack:
  added: []
  patterns:
    - "Breadcrumb (AppBreadcrumb) is the sole renderer of page name + icon"
    - "PageHeader still rendered for back link + actions only (props kept for compat)"
key-files:
  created: []
  modified:
    - "src/app/(dashboard)/companies/page.tsx"
    - "src/app/(dashboard)/contacts/imports/page.tsx"
    - "src/app/(dashboard)/contacts/page.tsx"
    - "src/app/(dashboard)/copilot/conversations/[id]/page.tsx"
    - "src/app/(dashboard)/copilot/conversations/page.tsx"
    - "src/app/(dashboard)/copilot/runs/[id]/page.tsx"
    - "src/app/(dashboard)/email-marketing/new/page.tsx"
    - "src/app/(dashboard)/email-marketing/page.tsx"
    - "src/app/(dashboard)/email-marketing/sections/page.tsx"
    - "src/app/(dashboard)/notes/page.tsx"
    - "src/app/(dashboard)/pipeline/list/page.tsx"
    - "src/app/(dashboard)/pipeline/page.tsx"
    - "src/app/(dashboard)/pipeline/settings/page.tsx"
    - "src/app/(dashboard)/scheduling/availability/page.tsx"
    - "src/app/(dashboard)/scheduling/bookings/page.tsx"
    - "src/app/(dashboard)/scheduling/calendar/page.tsx"
    - "src/app/(dashboard)/scheduling/page.tsx"
    - "src/app/(dashboard)/tasks/page.tsx"
    - "src/app/(dashboard)/workflows/flows/[id]/runs/page.tsx"
    - "src/app/(dashboard)/workflows/flows/new/page.tsx"
    - "src/app/(dashboard)/workflows/flows/page.tsx"
    - "src/app/(dashboard)/workflows/flows/runs/[runId]/page.tsx"
    - "src/app/(admin)/admin/_actions/seo-config.ts (deviation fix)"
decisions:
  - "Preserve dynamic h1s on 4 detail pages — slug-only breadcrumb cannot show entity names"
  - "Leave pipeline/[opportunityId] eyebrow alone — it contains dynamic stage + status, not a redundant section label"
  - "Leave reviews/page.tsx hero alone — bespoke gradient design with dynamic h1 and dynamic prompt content, not the generic dashboard pattern the plan targets"
metrics:
  duration: "~5 min"
  completed: "2026-05-20"
---

# Quick Task 260520-kc1: Remove Redundant Page Titles Summary

Removed redundant static h1+description blocks and eyebrow labels from 22 dashboard list pages so the top-bar breadcrumb is the only place page identity is rendered.

## What Shipped

22 dashboard page files cleaned up. Each previously rendered the page name twice (once in the breadcrumb, once inline as an `<h1>` with an `uppercase` eyebrow above it and a static description paragraph below). All those redundant blocks are gone; the breadcrumb keeps showing icon + page name; action buttons, filters, and tabs are intact.

## Files Modified (22)

All 22 dashboard pages listed in the plan's `key-files.modified` table. Plus one out-of-plan blocker fix (see Deviations).

## Files NOT Modified (4 of the 26 listed) — and Why

The plan listed 26 files; 4 needed no edits because they already conformed to the spec (dynamic h1 + no static description):

| File | Reason |
| ---- | ------ |
| `src/app/(dashboard)/contacts/imports/[id]/import-detail-client.tsx` | h1 is `{imp.filename}` (dynamic). No static `<p>` description, no eyebrow. Step 4 says preserve dynamic h1. Nothing to remove. |
| `src/app/(dashboard)/email-marketing/[id]/page.tsx` | h1 is `{template.name}` (dynamic). The adjacent `<p>` is a dynamic prompt preview (`{template.ai_prompt}`), not a static description. |
| `src/app/(dashboard)/pipeline/[opportunityId]/page.tsx` | h1 is `{opp.title}` (dynamic). The uppercase block above it contains the dynamic stage badge + status, not a redundant section label. No static `<p>` to remove. |
| `src/app/(dashboard)/reviews/page.tsx` | Bespoke gradient hero design. h1 is `{profile.business_name}` (dynamic); the "Live from Google" pill uses `tracking-widest` (not the canonical `tracking-[0.08em]` eyebrow). The block carries dynamic data (rating, address, distribution), not boilerplate. |

For all four files, the user's intent ("static text duplicated by breadcrumb") is already satisfied — the breadcrumb shows the slug, the page shows the entity name.

## Imports Removed

Removed from the 22 edited files: unused `lucide-react` icons that were previously imported only for eyebrow labels. Verified by `npm run build` (strict mode catches unused imports).

## Build Result

`npm run build` exits 0. TypeScript clean.

Initial build failed on a **pre-existing, out-of-plan** error in `src/app/(admin)/admin/_actions/seo-config.ts`:

```
Type error: Expected 2 arguments, but got 1.
> 36 |   revalidateTag('seo-favicon')
```

Next.js 16 requires `revalidateTag(tag, profile)`. Fixed (see Deviations).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking issue] Fixed `revalidateTag` signature for Next.js 16**

- **Found during:** post-task `npm run build` verification (success criterion)
- **Issue:** `src/app/(admin)/admin/_actions/seo-config.ts` had two pre-existing modifications calling `revalidateTag('seo-favicon')` without the required cache-profile argument. Next.js 16's signature is `revalidateTag(tag: string, profile: string | CacheLifeConfig)`. This was uncommitted work-in-progress sitting in the working tree before this task started.
- **Why I fixed it:** It blocked the success criterion `npm run build exits 0`. Per Rule 3 (auto-fix blocking issues).
- **Fix:** Introduced a `REVALIDATE_PROFILE = 'max'` constant and supplied it as the second argument at both call sites. `'max'` chosen because favicon invalidation needs to propagate immediately; `revalidatePath('/', 'layout')` already ran alongside it for the layout-level revalidation.
- **Files modified:** `src/app/(admin)/admin/_actions/seo-config.ts`
- **Commit:** `cb90ea9`

### Scope-Boundary Notes

The working tree contained many other modified files unrelated to this plan (auth/login, landing-page, sidebar, page-header, app-breadcrumb, globals.css, several components). Per the GSD SCOPE BOUNDARY rule, those were **not** staged, not modified, and not committed by this task. They remain in the working tree exactly as they were when the task started.

## Commits

| Hash      | Message                                                                              |
| --------- | ------------------------------------------------------------------------------------ |
| `35022a6` | refactor(260520-kc1): remove redundant page titles from 22 dashboard pages           |
| `cb90ea9` | fix(seo): supply cache profile to revalidateTag for Next.js 16                       |

## Verification

- `grep "text-\[28px\] sm:text-\[32px\]"` inside `src/app/(dashboard)/` → **0 matches**
- `npm run build` → **exit 0**, TypeScript clean
- 22 in-scope files cleaned; 4 dynamic-h1 detail pages preserved per Step 4
- Action buttons, tabs, filters preserved across all edits

## Self-Check: PASSED

- File `.planning/quick/260520-kc1-remove-redundant-page-titles-from-dashbo/260520-kc1-SUMMARY.md` — written
- Commit `35022a6` — exists in `git log`
- Commit `cb90ea9` — exists in `git log`
- All 22 target dashboard files appear in the `35022a6` diff
- Build exit code 0 confirmed
