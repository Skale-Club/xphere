---
plan: 83-02
status: complete
completed_at: "2026-05-19"
requirements_satisfied:
  - LND-04
  - LND-05
  - LND-06
---

# Summary: 83-02 — Auth pages redesign

## What was done

**`src/app/(auth)/layout.tsx`**: redirects authenticated users to `/dashboard` (was `/`). Layout is now a dark `#08090A` full-screen flex container — no card wrapper, handled per page.

**`src/app/(auth)/login/page.tsx`**: full redesign into a split layout:
- Left panel (lg+ only, 55% width): `#0D0D10` bg, animated grid, indigo glow, brand tagline "The AI backbone for modern agencies.", 3 animated feature bullet points with icon boxes. Framer Motion entrance animation.
- Right panel: `#08090A` bg, centered form — "Welcome back" heading + "Sign in to your workspace" subtext, Google button (outlined dark), email/password fields with dark styling, inline error banners with red tint box, "Sign in →" primary button (indigo)
- After successful password login: redirects to `/dashboard` (was `/`)
- Error alerts styled as bordered tinted boxes (replaces bare text)
- All form logic (react-hook-form, zod, Supabase) preserved unchanged

## Visual consistency with landing

Both pages share: `#08090A` bg, `#0D0D10` secondary surface, indigo accent (`#6366F1`), same text hierarchy (`#FAFAFA` / `#A1A1AA` / `#71717A`), border `white/10`.
