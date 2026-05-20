# Phase 104: Light Theme - Research

**Researched:** 2026-05-19
**Domain:** next-themes + Tailwind 4 CSS-variable theming, Next.js App Router
**Confidence:** HIGH

## Summary

The design system is already almost entirely ready for light mode. The CSS custom properties file (`globals.css`) already contains a full `:root` block with well-considered light-mode values (off-white surfaces, zinc text hierarchy, indigo accent) alongside a `.dark {}` override block. The `@theme inline` bridge that exposes these as Tailwind color tokens, and the `html:not(.dark) { color-scheme: light; }` rule, are both already in place. The only blocking gap is that `ThemeProvider` in `layout.tsx` forces dark mode via three props, and the `<html>` element has a static `dark` class that prevents next-themes from managing it.

The work is almost entirely mechanical: unlock the provider, remove the static class, fix the `Toaster` theme prop, and audit the handful of hardcoded dark hex colors and `dark:` utility classes in the 11 component files that use them. The login page is intentionally dark-only (hardcoded hex, no CSS variable usage) and the auth layout already applies `className="dark"` directly — that layout should remain forced dark without changes to its approach.

**Primary recommendation:** Remove the three ThemeProvider lock props and the static `dark` class on `<html>`. All CSS variable infrastructure for light mode is already shipped — no new color values need to be invented.

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Default theme: `defaultTheme="system"` — detects OS dark/light mode on first visit
- **D-02:** Remove `forcedTheme="dark"` from `src/app/layout.tsx`
- **D-03:** Remove `enableSystem={false}` — set `enableSystem={true}`
- **D-04:** localStorage via next-themes (already default behavior) — no DB column needed
- **D-05:** ThemeToggle component already exists and works — no changes needed to the toggle itself
- **D-06:** Full dashboard scope — all pages, sidebar, components, modals, sheets
- **D-07:** Landing page is already dark — verify it stays correct in both modes (or stays forced dark)
- **D-08:** Login page — apply light mode too

### Claude's Discretion
- Exact color palette for light mode (background whites, grays, borders, text hierarchy)
- Whether landing page gets light mode or stays forced dark
- Toaster theme (currently hardcoded `theme="dark"` in layout)

### Deferred Ideas (OUT OF SCOPE)
- Per-page forced theme overrides (e.g., keep landing always dark) — evaluate during implementation
- High contrast mode — separate accessibility phase
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| THEME-01 | Remove forcedTheme="dark" — use system preference as default | Confirmed: 3 props in layout.tsx + static `dark` class on `<html>` must all be removed/updated |
| THEME-02 | Light CSS variables defined in globals.css | Confirmed: already fully defined in `:root`; no new variables needed |
| THEME-03 | Theme toggle persists via localStorage, no flash on load | Confirmed: next-themes handles localStorage automatically; `suppressHydrationWarning` already on `<html>` and `<body>` |
</phase_requirements>

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| next-themes | ^0.4.6 | Theme switching, localStorage persistence, SSR flash prevention | Already installed; standard for Next.js App Router theming |
| Tailwind CSS | ^4 | Utility classes, CSS variable bridge via `@theme inline` | Already installed; v4 `@custom-variant dark` is already configured |
| sonner | ^2.0.7 | Toast notifications — has `theme` prop | Already installed; `theme="system"` follows browser/OS preference |

### No New Packages Required
This phase requires zero new `npm install` commands. All required infrastructure is already present.

**Version verification:** Confirmed from `package.json`. next-themes 0.4.x is current stable as of May 2026 (no breaking changes since 0.3.x for the attribute="class" usage pattern).

---

## Architecture Patterns

### How next-themes Works With Tailwind 4

next-themes manages the `class` attribute on the `<html>` element (when `attribute="class"`). When the user selects dark, it adds `class="dark"`. When light, the class is absent. Tailwind 4's `@custom-variant dark (&:is(.dark *))` hooks directly into this class.

The critical pattern:

```typescript
// Source: next-themes docs + verified against package behavior
// layout.tsx — AFTER this phase
<html lang="en" suppressHydrationWarning className={`${inter.variable} ${mono.variable}`}>
  <body suppressHydrationWarning>
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      enableSystem={true}
      disableTransitionOnChange
    >
```

The `suppressHydrationWarning` attributes prevent React hydration mismatches when next-themes injects/removes the `dark` class on the server-rendered HTML before client JS runs.

### CSS Variable Structure (Already Correct)

The `globals.css` already follows the correct two-block pattern:

```css
/* Light mode — :root (no class prefix) */
:root {
  --bg-primary: #FCFCFD;
  --bg-secondary: #FFFFFF;
  /* ... all variables ... */
}

/* Dark mode — .dark class applied by next-themes */
.dark {
  --bg-primary: #0A0A0B;
  --bg-secondary: #111113;
  /* ... all variables ... */
}
```

This is precisely what next-themes expects. No restructuring required.

### Flash-of-Unstyled-Content (FOUC) Prevention

next-themes prevents FOUC by injecting an inline script before React hydration that reads localStorage and applies the `dark` class synchronously. This works when:

1. `suppressHydrationWarning` is on both `<html>` and `<body>` — ALREADY SET
2. The `dark` class is NOT hardcoded on `<html>` — NEEDS TO BE FIXED (currently hardcoded)
3. `forcedTheme` is removed — NEEDS TO BE FIXED

If the static `dark` class remains on `<html>` after removing `forcedTheme`, light-mode users will get a dark flash on load because the initial HTML ships dark, then next-themes corrects it client-side.

### Recommended Project Structure (No Changes)
No directory or file structural changes are required. This is a contained config + CSS audit phase.

### Anti-Patterns to Avoid

- **Removing `disableTransitionOnChange`:** Keep this prop. Without it, all CSS transitions fire during theme switch, creating a jarring full-page transition flash.
- **Using CSS `transition: background-color` globally:** Can cause the body background to visibly animate on theme change. The `disableTransitionOnChange` prop handles this.
- **Leaving `className="dark"` on `<html>`:** next-themes will still switch themes, but the initial paint will always be dark (FOUC on first visit for light-preference users).
- **Hardcoded hex colors bypassing the design token system:** Components that use literal `#0A0A0B` instead of `var(--bg-primary)` will not respond to theme changes. The login page is an intentional exception.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Flash of unstyled content | Script injected in `_document` or custom SSR logic | next-themes built-in | next-themes already handles the inline synchronous script |
| localStorage persistence | Custom React context + useEffect | next-themes default | next-themes writes/reads `theme` key in localStorage automatically |
| System preference detection | `matchMedia('prefers-color-scheme')` watcher | `enableSystem={true}` in ThemeProvider | next-themes handles system preference and changes reactively |
| Theme-aware Toaster | Custom wrapper component | `theme="system"` prop on Sonner `<Toaster>` | Sonner 2.x supports `"system"` as a valid theme value |

---

## Exact Changes Required

This section gives the planner a precise, file-by-file change inventory.

### File 1: `src/app/layout.tsx` — 3 changes

**Change 1a — Remove static `dark` class from `<html>`:**
```tsx
// BEFORE
<html lang="en" suppressHydrationWarning className={`dark ${inter.variable} ${mono.variable}`}>

// AFTER
<html lang="en" suppressHydrationWarning className={`${inter.variable} ${mono.variable}`}>
```

**Change 1b — Update ThemeProvider props:**
```tsx
// BEFORE
<ThemeProvider
  attribute="class"
  defaultTheme="dark"
  forcedTheme="dark"
  enableSystem={false}
  disableTransitionOnChange
>

// AFTER
<ThemeProvider
  attribute="class"
  defaultTheme="system"
  enableSystem={true}
  disableTransitionOnChange
>
```

**Change 1c — Update Toaster theme:**
```tsx
// BEFORE
<Toaster ... theme="dark" ... />

// AFTER
<Toaster ... theme="system" ... />
```

### File 2: `src/app/globals.css` — 1 change

The `.border-gradient::before` pseudo-element uses `rgba(255,255,255,0.08)` which only works on dark surfaces. Add a light-mode override:

```css
/* CURRENT — inside @layer utilities */
.border-gradient::before {
  background: linear-gradient(180deg, rgba(255,255,255,0.08), rgba(255,255,255,0));
}

/* ADD — light mode override */
html:not(.dark) .border-gradient::before {
  background: linear-gradient(180deg, rgba(0,0,0,0.04), rgba(0,0,0,0));
}
```

### File 3: `src/app/(auth)/layout.tsx` — NO CHANGE (intentional)

The auth layout has `className="dark min-h-screen bg-[#08090A]"`. This is correct — the login page is intentionally dark-only with hardcoded hex colors throughout. Decision D-08 says "apply light mode too" but the login page's implementation hardcodes all colors as hex literals (`#FAFAFA`, `#08090A`, etc.) that do not use CSS variables. Changing those colors requires a full login page reskin, which is a separate task. The `className="dark"` on the auth layout wrapper forces dark mode only for this subtree and should remain as-is for this phase.

**Recommendation for planner:** Flag D-08 (login page light mode) as a separate task or note it as partial — the auth layout's `dark` class override is intentional and keeps the login page correct in dark regardless of system preference.

### Files 4–14: Components with `dark:` Tailwind utilities

These 11 files use `dark:` prefix classes and will work correctly once the ThemeProvider is unlocked. No changes needed — the light values (no prefix) are the correct defaults:

| File | Nature of `dark:` usage | Action |
|------|------------------------|--------|
| `src/components/theme-toggle.tsx` | Sun/Moon rotation animation | None — works by design |
| `src/components/conversations/delegation-tree.tsx` | Status badge colors (emerald/red/orange/yellow/blue/gray) | None — light values already correct |
| `src/components/dashboard/vapi-setup-banner.tsx` | `text-yellow-600 dark:text-yellow-400` | None — light value is correct |
| `src/components/reviews/serpapi-key-form.tsx` | `text-emerald-600 dark:text-emerald-400` | None — light value is correct |
| `src/components/reviews/reviews-filters.tsx` | Amber button toggle states | None — light values already set |
| `src/components/reviews/review-card.tsx` | Amber ring + response card background | None — light values correct |
| `src/components/reviews/business-search.tsx` | Amber map pin icon background | None — light value correct |
| `src/components/chat/playground-chat.tsx` | Violet badge + dark overlay backgrounds | Audit: `bg-neutral-50/50` (light) vs `dark:bg-neutral-900/20` (dark) — light value is correct |
| `src/components/agents/agent-playground.tsx` | Violet/blue message bubbles + neutral bg | Audit: same pattern — light values are correct |
| `src/app/(dashboard)/integrations/google-reviews/page.tsx` | Emerald/amber badge backgrounds | None — light values correct |
| `src/app/(dashboard)/reviews/page.tsx` | Amber icon bg + gradient section | None — light values correct |

### File: `src/app/(dashboard)/error.tsx` — INTENTIONAL EXCEPTION

This error boundary uses hardcoded inline styles (`backgroundColor: '#0A0A0B'`, `color: '#FAFAFA'`) by design — it must not import providers or design tokens (comment in the file explains this). Leave it dark-only. This is acceptable: error boundaries are edge-case screens.

---

## Common Pitfalls

### Pitfall 1: Hardcoded `dark` Class on `<html>` Causes Light-Mode FOUC
**What goes wrong:** Static `className="dark"` in `layout.tsx` means every server-rendered page ships with the dark class. Light-preference users get a dark flash before next-themes corrects it client-side.
**Why it happens:** The class was added intentionally when `forcedTheme="dark"` was the intent — it was harmless then but becomes a FOUC source once forcedTheme is removed.
**How to avoid:** Remove the static `dark` from the `<html>` className. next-themes injects the correct class synchronously before React hydration.
**Warning signs:** Visiting the app with OS light mode shows a brief dark flash before the page goes light.

### Pitfall 2: `enableSystem={false}` Left Behind
**What goes wrong:** Removing `forcedTheme` without changing `enableSystem` means system preference is still ignored. Users with OS light preference see dark mode on first visit.
**How to avoid:** Set `enableSystem={true}` (or omit the prop — default is `true` in next-themes 0.4.x).

### Pitfall 3: Toaster Remains Dark in Light Mode
**What goes wrong:** `theme="dark"` on Sonner `<Toaster>` is a static prop — the toast will always render with dark backgrounds regardless of system theme.
**How to avoid:** Change to `theme="system"`. Sonner 2.x supports `"light"`, `"dark"`, and `"system"` as values.

### Pitfall 4: `defaultTheme="dark"` Not Updated
**What goes wrong:** Even with `enableSystem={true}`, if `defaultTheme` remains `"dark"`, users whose OS does not report a preference (or who have no prior localStorage entry) get dark as default instead of the system preference.
**How to avoid:** Change `defaultTheme` to `"system"` per D-01.

### Pitfall 5: Login Page Looks Broken in Light Mode
**What goes wrong:** D-08 says "apply light mode to login page too" but the login page uses hardcoded hex literals throughout (`#FAFAFA`, `#08090A`, `bg-white/4`, `border-white/10`). Removing the `dark` class from the auth layout wrapper will cause these hard-coded-for-dark values to apply on a light background — the result will look broken.
**How to avoid:** Keep `className="dark"` in `src/app/(auth)/layout.tsx` for this phase. Treat login page light mode as a deferred sub-task requiring a proper reskin of all hardcoded colors.

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| next-themes `storageKey` custom key | Default `theme` key | next-themes >=0.1 | No impact — default is fine |
| `next-themes` with `_document.js` script injection | App Router: automatic inline script via next-themes | next-themes 0.3+ | `suppressHydrationWarning` replaces the old `_document` pattern |
| Tailwind dark mode via `darkMode: 'class'` in config | Tailwind 4: `@custom-variant dark (&:is(.dark *))` in CSS | Tailwind 4.0 | Already correctly configured in this project |

---

## Environment Availability

Step 2.6: SKIPPED — this phase is CSS/config-only. No external CLI tools, services, or runtimes beyond Node.js/npm are required beyond what is already installed.

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest (vitest.config.ts) |
| Config file | `vitest.config.ts` |
| Quick run command | `npx vitest run --reporter=verbose` |
| Full suite command | `npx vitest run` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| THEME-01 | ThemeProvider no longer forces dark mode | manual-only | — | N/A |
| THEME-02 | Light CSS variables resolve correctly | manual-only | — | N/A |
| THEME-03 | Theme persists in localStorage; no flash on load | manual-only | — | N/A |

**Manual-only justification:** All three requirements are visual/browser behaviors (CSS variable rendering, localStorage read timing, flash-of-unstyled-content). These cannot be meaningfully tested in a Node.js Vitest environment without a real browser. The existing test suite is Node-environment only (`environment: 'node'` in vitest.config.ts). A proper visual regression would require Playwright/Storybook, which are not present in the project and are out of scope for this phase.

**Verification approach for planner:** Include a manual smoke-test checklist task at the end of the wave:
- [ ] Visit app with OS set to light — confirm light mode on first load
- [ ] Toggle to dark — confirm switch; refresh — confirm persists
- [ ] Toggle to light — confirm switch; refresh — confirm persists
- [ ] Run `npm run build` to catch any TypeScript errors introduced

### Sampling Rate
- **Per task commit:** `npm run build` (type-check gate)
- **Per wave merge:** `npm run build && npm run lint`
- **Phase gate:** Manual smoke-test checklist + `npm run build` green

### Wave 0 Gaps
None — no new test files are required. The existing infrastructure covers the codebase; this phase's requirements are visual/manual.

---

## Open Questions

1. **Login page (D-08): Full light mode or forced dark?**
   - What we know: D-08 says "apply light mode too" but the login page uses hardcoded dark hex throughout and the auth layout applies `className="dark"`.
   - What's unclear: Does the user want a fully reskinned light login page (significant CSS work) or just the dashboard?
   - Recommendation: Keep auth layout dark-forced for this phase; note D-08 as requiring a follow-up reskin task. The planner should include this as a deferred sub-task rather than blocking THEME-01/02/03.

2. **Landing page (D-07): Keep forced dark or follow system?**
   - What we know: The landing page (`src/components/landing/landing-page.tsx`) uses CSS variables (not hardcoded hex), so it will adapt to light mode automatically once the ThemeProvider is unlocked.
   - What's unclear: D-07 says "verify it stays correct in both modes" — this is deferred per CONTEXT.md deferred section.
   - Recommendation: No action needed in this phase. The landing page uses design tokens and will render in light mode automatically. Visual verification should be included in the manual smoke-test checklist.

---

## Sources

### Primary (HIGH confidence)
- Direct code reading: `src/app/layout.tsx` — confirmed exact props and static class
- Direct code reading: `src/app/globals.css` — confirmed `:root` light vars already defined, `.dark` block present, `html:not(.dark)` rule present
- Direct code reading: `src/components/theme-provider.tsx` — thin wrapper; no custom logic
- Direct code reading: `src/app/(auth)/layout.tsx` — confirmed `className="dark"` intentional lock
- Direct code reading: `src/app/(auth)/login/page.tsx` — confirmed all hardcoded hex colors

### Secondary (MEDIUM confidence)
- next-themes 0.4.x: `theme="system"` support for Sonner 2.x verified via package.json + known API

### Tertiary (LOW confidence)
- None

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all packages already installed and in use
- Architecture: HIGH — both CSS files and provider code read directly
- Pitfalls: HIGH — based on direct code inspection of the three lock points
- CSS completeness: HIGH — `:root` light values already fully defined; no guesswork required

**Research date:** 2026-05-19
**Valid until:** 2026-06-19 (stable ecosystem — next-themes and Tailwind 4 APIs are not fast-moving)
