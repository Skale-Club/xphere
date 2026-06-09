'use client'

// Dashboard segment not-found boundary.
//
// Catches ANY notFound() thrown in the (dashboard) tree — most importantly when
// an org switch invalidates a deep org-scoped URL (e.g. /workflows/flows/{id}
// belongs to the previous org, so RLS hides it under the new org and the page
// calls notFound()). Also covers deleted resources and stale/bad deep links.
//
// Renders INSIDE the dashboard layout (sidebar/topbar/OrgSwitcher stay mounted)
// instead of Next's bare 404, and auto-recovers to the section root. The
// destination is always a nav href or /dashboard (guaranteed to have a page),
// so the redirect can never 404 or loop.

import { useEffect } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { findNavItemForPath, sectionRootForPath } from '@/components/layout/nav-items'
import { Button } from '@/components/ui/button'

export default function DashboardNotFound() {
  const pathname = usePathname()
  const router = useRouter()
  const dest = sectionRootForPath(pathname)
  const sectionLabel = findNavItemForPath(pathname)?.label ?? 'Dashboard'

  useEffect(() => {
    // Self-heal: leave the invalid URL for a guaranteed-valid section root.
    // Guard avoids a redirect loop if the section root itself ever renders here.
    if (dest !== pathname) router.replace(dest)
  }, [dest, pathname, router])

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-6 text-center">
      <div className="max-w-md">
        <p className="text-5xl font-semibold tracking-tight text-text-primary">404</p>
        <h1 className="mt-4 text-lg font-medium text-text-primary">
          This page isn&apos;t available
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-text-secondary">
          It may not exist in this organization, or it was moved or deleted.
          Taking you back to {sectionLabel}…
        </p>
        <div className="mt-6 flex items-center justify-center gap-2">
          <Button asChild>
            <Link href={dest} replace>
              Go to {sectionLabel}
            </Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/dashboard" replace>
              Dashboard
            </Link>
          </Button>
        </div>
      </div>
    </div>
  )
}
