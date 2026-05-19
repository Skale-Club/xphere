---
plan: 83-01
status: complete
completed_at: "2026-05-19"
requirements_satisfied:
  - LND-01
  - LND-02
  - LND-03
---

# Summary: 83-01 — Landing page (hero, features, CTA)

## What was done

**`src/app/page.tsx`**: server component — redirects authenticated users to `/dashboard`, renders `LandingPage` for guests.

**`src/components/landing/landing-page.tsx`**: full dark-mode landing page with:
- Fixed dark grid background + indigo glow orb (CSS only, aria-hidden)
- **Nav**: logo left, "Sign in" button right
- **Hero**: animated eyebrow badge, gradient headline "Run your agency on autopilot", subheadline, two CTAs ("Get started free" → /login, "See features" → #features anchor)
- **Dashboard preview strip**: mock stat cards (Calls Today, Active Contacts, Open Conversations) inside a browser-chrome frame
- **Features grid**: 6 feature cards with indigo icon boxes, scroll-reveal animation via `whileInView`
- **CTA section**: gradient card, "Ready to scale your agency?" + CTA button
- **Footer**: copyright

Framer Motion used for all enter animations (explicit `initial/animate/transition` per element, `whileInView` for below-fold sections).
