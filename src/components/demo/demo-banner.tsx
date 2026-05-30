import Link from 'next/link'
import { Eye } from 'lucide-react'

import { Button } from '@/components/ui/button'

/**
 * Persistent banner shown across the public read-only demo. Explains the demo
 * is read-only with sample data and offers a signup CTA. Rendered only for the
 * shared demo session (see dashboard layout) — superadmins editing the demo org
 * never see it.
 */
export function DemoBanner() {
  return (
    <div className="sticky top-0 z-40 flex w-full flex-col items-center gap-2 border-b border-indigo-500/30 bg-indigo-500/10 px-4 py-2 text-sm backdrop-blur sm:flex-row sm:justify-center">
      <div className="flex items-center gap-2 text-center text-indigo-100">
        <Eye className="h-4 w-4 shrink-0 text-indigo-300" aria-hidden />
        <span>
          You are viewing a <strong>read-only Xphere demo</strong> with sample data.
          Explore the platform, then create your own account when ready.
        </span>
      </div>
      <Link href="/demo/exit" className="shrink-0">
        <Button size="sm" className="h-8 px-4">
          Create my account
        </Button>
      </Link>
    </div>
  )
}
