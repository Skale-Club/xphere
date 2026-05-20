# Phase 104: Light Theme - Context

**Gathered:** 2026-05-19
**Status:** Ready for planning

<domain>
## Phase Boundary

Enable full light mode across the dashboard by removing the `forcedTheme="dark"` lock, defining light-mode CSS variable values, and letting the existing ThemeToggle + next-themes handle switching. Theme preference stored in localStorage.

</domain>

<decisions>
## Implementation Decisions

### Default Theme
- **D-01:** System preference (`defaultTheme="system"`) — detects OS dark/light mode on first visit
- **D-02:** Remove `forcedTheme="dark"` from `src/app/layout.tsx`
- **D-03:** Remove `enableSystem={false}` — set `enableSystem={true}`

### Persistence
- **D-04:** localStorage via next-themes (already the default behavior) — no DB column needed
- **D-05:** ThemeToggle component already exists and works — no changes needed to the toggle itself

### Scope
- **D-06:** Full dashboard scope — all pages, sidebar, components, modals, sheets
- **D-07:** Landing page is already dark — verify it stays correct in both modes (or stays forced dark)
- **D-08:** Login page — apply light mode too

### CSS Approach
- **D-09:** CSS variables already defined in `globals.css` for dark mode — add `:root` (light) values for all custom variables
- **D-10:** Tailwind `dark:` classes already used throughout — light mode = default (no prefix) values

### Claude's Discretion
- Exact color palette for light mode (background whites, grays, borders, text hierarchy)
- Whether landing page gets light mode or stays forced dark
- Toaster theme (currently hardcoded `theme="dark"` in layout)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Key Files to Read
- `src/app/layout.tsx` — ThemeProvider config; remove `forcedTheme` and `enableSystem={false}`
- `src/app/globals.css` — CSS custom properties; add light mode `:root` values alongside existing dark vars
- `src/components/theme-toggle.tsx` — Already implemented, no changes needed
- `src/components/layout/top-bar.tsx` — ThemeToggle already rendered in header
- `src/components/layout/app-sidebar.tsx` — Sidebar needs light mode verification
- `src/components/layout/sidebar.tsx` — Secondary sidebar

No external specs — requirements fully captured in decisions above.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `ThemeToggle` (`src/components/theme-toggle.tsx`): fully implemented Sun/Moon toggle using `next-themes`
- `next-themes`: already installed and configured in ThemeProvider
- CSS variables: `bg-bg-primary`, `bg-bg-secondary`, `border-border-subtle`, `text-text-primary`, etc. — all custom vars need light equivalents

### Established Patterns
- Dark mode is currently the only mode (`forcedTheme="dark"`)
- Components use both CSS variables AND Tailwind `dark:` classes — both approaches need light values
- `suppressHydrationWarning` on `<html>` and `<body>` — already set for theme switching

### Integration Points
- `src/app/layout.tsx` — single config change unlocks the system
- `src/app/globals.css` — add `:root { }` light-mode variable block
- Toaster in layout: `theme="dark"` hardcoded — change to `theme="system"` or dynamic

</code_context>

<specifics>
## Specific Ideas

- Light mode should feel clean and professional — not pure white, use off-whites (zinc-50/100 range)
- Sidebar in light mode: light gray background, not white
- Keep the indigo accent color consistent across both themes

</specifics>

<deferred>
## Deferred Ideas

- Per-page forced theme overrides (e.g., keep landing always dark) — evaluate during implementation
- High contrast mode — separate accessibility phase

</deferred>

---

*Phase: 104-light-theme*
*Context gathered: 2026-05-19*
