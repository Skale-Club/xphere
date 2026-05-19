---
plan: 84-01
status: complete
completed_at: "2026-05-19"
requirements_satisfied:
  - SEO-01
  - SEO-02
  - SEO-03
---

# Summary: 84-01 — Metadata, sitemap.xml, robots.txt

## What was done

**`src/app/page.tsx`**: added full `metadata` export — title, description, metadataBase, openGraph (title/description/url/siteName/type/locale), twitter card (summary_large_image), keywords array, canonical alternates.

**`src/app/(auth)/layout.tsx`**: added `metadata` export for auth group — "Sign in | Xphere", description, `robots: { index: false, follow: false }` (auth pages excluded from search engines).

**`src/app/sitemap.ts`**: `MetadataRoute.Sitemap` export — two entries: `/` (priority 1, weekly) and `/login` (priority 0.3, monthly). Base URL from `NEXT_PUBLIC_SITE_URL ?? 'https://xphere.skale.club'`.

**`src/app/robots.ts`**: `MetadataRoute.Robots` export — allow `/` and `/login`, disallow `/dashboard/`, `/admin/`, `/api/`. Sitemap URL included.
