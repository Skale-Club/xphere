---
phase: 05-admin-configuration
verified: 2026-04-04T23:30:00Z
status: gaps_found
score: 11/13 must-haves verified
re_verification: false
gaps:
  - truth: "The page shows the canonical embed script tag using the correct production host"
    status: partial
    reason: "Embed code uses https://opps.skale.club/widget.js but CLAUDE.md declares https://operator.skale.club as the canonical production origin. The PLAN spec said https://voiceops.skale.club/widget.js. The active host in code is neither the plan spec nor the current CLAUDE.md canonical origin."
    artifacts:
      - path: "src/components/widget/widget-settings-form.tsx"
        issue: "Line 85: embed code hardcodes https://opps.skale.club/widget.js — does not match CLAUDE.md canonical origin https://operator.skale.club"
    missing:
      - "Update embed URL to match the canonical production origin in CLAUDE.md (https://operator.skale.club/widget.js), or update CLAUDE.md to document opps.skale.club as the new canonical origin"
  - truth: "Database types reflect the new organization columns (including widget_avatar_url)"
    status: partial
    reason: "widget_avatar_url exists in Row type but is absent from Insert and Update type definitions. Migration 014 added the column after Phase 5 was planned, but the database.ts was not updated to include it in Insert/Update."
    artifacts:
      - path: "src/types/database.ts"
        issue: "Insert.organizations and Update.organizations are missing widget_avatar_url field; it only appears in Row"
    missing:
      - "Add widget_avatar_url?: string | null to both Insert and Update type definitions for organizations"
human_verification:
  - test: "End-to-end browser flow — confirm saved widget settings appear in real embedded widget"
    expected: "Admin saves display name, color, welcome message in /widget page; embedded widget on a third-party page reflects those values on next load"
    why_human: "Requires a running app with a live Supabase connection and a real browser to confirm actual config endpoint consumption by the shipped widget.js bundle"
  - test: "Token regeneration invalidation"
    expected: "After regenerating the token in /widget, the old embed script stops resolving config and chat; the new token embed works"
    why_human: "Depends on live Supabase state and network calls — cannot be verified from static codebase analysis"
---

# Phase 05: Admin Configuration Verification Report

**Phase Goal:** Deliver the widget admin configuration surface — allow admins to set display name, primary color, welcome message, embed code, preview, public config endpoint, and token regeneration.
**Verified:** 2026-04-04T23:30:00Z
**Status:** gaps_found (2 gaps, both minor — core goal is functionally achieved)
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | organizations gains widget_display_name, widget_primary_color, widget_welcome_message columns | VERIFIED | `supabase/migrations/013_org_widget_config.sql` adds all 3 columns as nullable TEXT |
| 2 | GET /api/widget/[token]/config resolves orgs by widget_token and returns only public-safe fields | VERIFIED | Route queries `.eq('widget_token', token)`, returns displayName/primaryColor/welcomeMessage/avatarUrl only |
| 3 | Invalid or inactive tokens return 401 | VERIFIED | Route checks `!org || !org.is_active` and returns `{ status: 401 }` |
| 4 | Null/blank config values are normalized to Phase 4 defaults | VERIFIED | `normalizeWidgetValue()` in route handles null/empty strings with fallback constants |
| 5 | Database types reflect new organization columns | PARTIAL | Row type has all fields including widget_avatar_url; Insert/Update are missing widget_avatar_url (from migration 014) |
| 6 | A new /widget dashboard page exists and is reachable from the sidebar | VERIFIED | `src/app/(dashboard)/widget/page.tsx` exists; sidebar navItems array includes `{ label: 'Widget', href: '/widget' }` |
| 7 | Admins can edit display name, primary color, and welcome message and save via server action | VERIFIED | `saveWidgetSettings()` in actions.ts updates all 3 fields on the active org row |
| 8 | The page shows a live preview reflecting unsaved edits immediately | VERIFIED | `widget-settings-form.tsx` uses `form.watch()` → passes `previewValues` to `<WidgetPreview>` in real-time |
| 9 | The page shows the canonical embed script tag with the widget token | PARTIAL | Embed code is present and uses the current token; host is https://opps.skale.club which diverges from CLAUDE.md canonical origin (https://operator.skale.club) |
| 10 | Admins can regenerate widget_token with an explicit invalidation warning | VERIFIED | `regenerateWidgetToken()` uses `crypto.randomUUID()`, wrapped in AlertDialog with explicit "all existing installs stop working" copy |
| 11 | Hex color validation is enforced client-side and server-side | VERIFIED | Client: zod regex `/^#[0-9A-Fa-f]{6}$/`; Server: `HEX_COLOR_REGEX` in actions.ts before persistence |
| 12 | Widget fetches /api/widget/[token]/config at startup and applies config | VERIFIED | `fetchWidgetConfig()` in `src/widget/index.ts` calls the endpoint; `applyConfig()` updates DOM; `public/widget.js` bundle contains the pattern |
| 13 | Config fetch failure falls back to Phase 4 defaults without breaking boot | VERIFIED | `fetchWidgetConfig()` catches all errors and returns `DEFAULT_WIDGET_CONFIG`; widget init continues regardless |

**Score:** 11/13 truths verified (2 partial)

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `supabase/migrations/013_org_widget_config.sql` | Append-only schema change | VERIFIED | Adds 3 nullable TEXT columns via ALTER TABLE; does not touch prior migrations |
| `src/types/database.ts` | Updated TypeScript types for organizations | PARTIAL | Row type includes all 5 widget fields; Insert/Update missing widget_avatar_url |
| `src/app/api/widget/[token]/config/route.ts` | Public config endpoint | VERIFIED | Substantive implementation; token lookup, active check, normalization, 401 handling |
| `tests/widget-config-route.test.ts` | Coverage for valid/invalid/inactive/defaults | VERIFIED | 4 tests covering all cases; mocks service-role client correctly |
| `src/app/(dashboard)/widget/page.tsx` | Authenticated widget admin route | VERIFIED | Server component, auth gating, active-org scoped query, passes data to WidgetSettingsForm |
| `src/app/(dashboard)/widget/actions.ts` | Server actions for save + token rotation | VERIFIED | `saveWidgetSettings()` and `regenerateWidgetToken()` both implemented with validation and revalidatePath |
| `src/components/widget/widget-settings-form.tsx` | Interactive form with live preview and save UX | VERIFIED | Client component with react-hook-form + zod + sonner, form.watch() drives preview |
| `src/components/widget/widget-preview.tsx` | Local preview mirror of widget UI | VERIFIED | Renders displayName, primaryColor (via style prop), welcomeMessage from props |
| `src/components/layout/app-sidebar.tsx` | Widget nav entry | VERIFIED | MessageSquare icon, label 'Widget', href '/widget', active: true in navItems array |
| `src/widget/index.ts` | Widget startup config fetch + runtime UI overrides | VERIFIED | `fetchWidgetConfig()` implemented; `applyConfig()` updates avatar, botName, emptyAvatar, emptyHeading |
| `tests/widget.test.ts` | Config hydration and fallback coverage | VERIFIED | 3 new tests in 'Widget — runtime config hydration and fallback (ADMIN-01)' describe block |
| `public/widget.js` | Rebuilt IIFE bundle with config-fetch | VERIFIED | 13,925 bytes; contains `api/widget/${t}/config` pattern confirming bundle was rebuilt |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `route.ts (config)` | `organizations.widget_token` | `.eq('widget_token', token)` | WIRED | Pattern confirmed at line 29 of route.ts |
| `actions.ts` | `organizations` widget columns | `.update({ widget_display_name, widget_primary_color, widget_welcome_message })` | WIRED | saveWidgetSettings() updates all 3 fields by active org id |
| `actions.ts` | `organizations.widget_token` | `.update({ widget_token: widgetToken })` | WIRED | regenerateWidgetToken() replaces token with crypto.randomUUID() |
| `widget-settings-form.tsx` | `widget-preview.tsx` | `previewValues` from `form.watch()` | WIRED | previewValues passed as displayName/primaryColor/welcomeMessage props to WidgetPreview |
| `widget-settings-form.tsx` | `actions.ts` | `saveWidgetSettings(values)` and `regenerateWidgetToken()` | WIRED | Both imported and called in onSubmit and handleRegenerateToken |
| `src/widget/index.ts` | `/api/widget/${token}/config` | `fetchWidgetConfig()` GET fetch at boot | WIRED | fetch called in initWidget(); applyConfig() consumes result |
| `src/widget/index.ts` | DOM (displayName/primaryColor/welcomeMessage) | `applyConfig()` mutating avatar/botName/emptyHeading | WIRED | applyConfig updates 4 DOM nodes; primaryColor applied via CSS custom property on host |

---

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|--------------|--------|--------------------|--------|
| `widget/page.tsx` | `organization` (widget settings) | `supabase.from('organizations').select(...).eq('id', activeOrgId).single()` | Yes — DB query scoped to active org | FLOWING |
| `route.ts (config)` | `org` (widget config) | `supabase.from('organizations').select(...).eq('widget_token', token).single()` | Yes — DB query by token | FLOWING |
| `widget-preview.tsx` | `displayName`, `primaryColor`, `welcomeMessage` | Props from `previewValues` (form.watch()) | Yes — live form state | FLOWING |
| `src/widget/index.ts` | `config` object | `fetchWidgetConfig()` → GET /api/widget/[token]/config | Yes — runtime fetch from DB-backed endpoint | FLOWING |

---

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| widget.js bundle contains config fetch pattern | `grep "api/widget" public/widget.js` | 1 match with `api/widget/${t}/config` | PASS |
| widget.js bundle exists and is non-trivial | `wc -c public/widget.js` | 13,925 bytes | PASS |
| Migration 013 is append-only | Read file contents | Only ALTER TABLE ADD COLUMN statements | PASS |
| Sidebar includes Widget nav item | Read app-sidebar.tsx navItems | `{ label: 'Widget', href: '/widget', active: true }` present | PASS |
| Server action uses cached auth helpers | Read actions.ts | `getUser()` and `createClient()` from `@/lib/supabase/server` — no raw `supabase.auth.getUser()` | PASS |

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| ADMIN-01 | 05-01, 05-02, 05-03 | Admin can configure widget appearance per org (display name, primary color, welcome message) | SATISFIED | migration 013, actions.ts saveWidgetSettings, widget page, widget runtime hydration |
| ADMIN-02 | 05-02 | Admin page shows the embed `<script>` tag ready to copy | SATISFIED | widget-settings-form.tsx renders embed code with copy button |
| ADMIN-03 | 05-02 | Admin page shows a live preview of the widget with current configuration | SATISFIED | WidgetPreview driven by form.watch() updates before save |
| ADMIN-04 | 05-02 | Admin can regenerate the org's widget public token (invalidates old installs) | SATISFIED | regenerateWidgetToken() in actions.ts with AlertDialog danger zone in form |

All 4 ADMIN requirements are satisfied. No orphaned requirements were found for Phase 5.

---

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `src/types/database.ts` | 37-58 | `widget_avatar_url` absent from `Insert` and `Update` types (present only in `Row`) | Warning | TypeScript won't catch accidental omission of avatarUrl in insert/update queries — runtime behavior unaffected since Supabase accepts the column |
| `src/components/widget/widget-settings-form.tsx` | 85 | Embed URL hardcoded as `https://opps.skale.club/widget.js` — mismatches CLAUDE.md canonical origin `https://operator.skale.club` | Warning | Admins copying the embed snippet get an incorrect domain if opps.skale.club is not the active production host |

No blocking anti-patterns were found. The above are warnings that do not prevent the phase goal from being achieved functionally but may cause operational confusion.

---

### Human Verification Required

#### 1. End-to-end widget config consumption

**Test:** In a running app with a live Supabase connection, navigate to `/widget`, change display name, primary color, and welcome message, save, then load the embedded widget (via `public/widget-test.html` or a test page with the current token). Confirm the widget header/name, accent color, and welcome copy match the saved values.

**Expected:** Widget fetches `/api/widget/[token]/config` at startup and applies the admin-configured values to the UI without falling back to defaults.

**Why human:** Requires a live Supabase database with the org's token, a running Next.js server, and a real browser to observe actual DOM updates from the async config fetch.

#### 2. Token regeneration invalidation

**Test:** From `/widget`, click Regenerate Token. Copy the old token. Verify the page shows a new token in the embed script. Then load a page with the old embed snippet and confirm the widget can no longer fetch config or initiate chat (401 responses). Update to the new token and confirm functionality is restored.

**Expected:** Old token returns 401 immediately after rotation; new token works without any server restart.

**Why human:** Depends on live Supabase state mutation and real HTTP calls to the config and chat routes. The 05-04-SUMMARY.md documents that a human operator confirmed this on 2026-04-05 with all 8 checklist items approved.

---

### Gaps Summary

Two minor gaps were found, neither of which blocks the phase goal:

**Gap 1 — Embed URL host mismatch:** The widget settings form hardcodes `https://opps.skale.club/widget.js` in the embed snippet. CLAUDE.md documents `https://operator.skale.club` as the canonical production origin. The plan spec referenced `https://voiceops.skale.club`. The rebranding commit `6ff81b2` introduced "Opps" branding and likely changed this URL, but CLAUDE.md was not updated to reflect it — or vice versa. Resolution requires either updating the embed URL to `https://operator.skale.club/widget.js` to match CLAUDE.md, or updating CLAUDE.md to declare `https://opps.skale.club` as the current canonical origin.

**Gap 2 — Incomplete database types for widget_avatar_url:** Migration `014_whitelabel_avatar.sql` added `widget_avatar_url` to the organizations table after Phase 5 planning, but `src/types/database.ts` was only updated to reflect it in the `Row` type. `Insert` and `Update` types do not include this field. This is a low-severity issue since runtime behavior is unaffected (Supabase will accept the column), but it weakens TypeScript safety for insert/update operations involving avatar URLs.

Both gaps are correctable in a minor follow-up without re-doing phase work. The human verification checkpoint (Plan 04) was approved by the human operator on 2026-04-05, confirming the end-to-end flow works in a real browser.

---

_Verified: 2026-04-04T23:30:00Z_
_Verifier: Claude (gsd-verifier)_
