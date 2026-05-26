import Link from 'next/link'
import { ArrowRight, AlertCircle } from 'lucide-react'

export interface MergedBannerProps {
  survivorId: string
  survivorName: string | null
}

/**
 * Banner rendered for contacts whose `identity_status === 'archived_duplicate'`.
 * Tells the operator the contact was merged into another and links to the
 * survivor. `survivorName` is resolved by the caller (typically via the
 * `getSurvivorDisplayName` server action). When null we fall back to the
 * generic word "survivor" so the link remains usable.
 */
export function MergedBanner({ survivorId, survivorName }: MergedBannerProps) {
  return (
    <div className="flex items-center gap-2 rounded-md border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-sm">
      <AlertCircle className="h-4 w-4 shrink-0 text-amber-500" />
      <span className="text-text-secondary">This contact was merged into</span>
      <Link
        href={`/contacts/${survivorId}`}
        className="inline-flex items-center gap-1 font-medium text-accent hover:underline"
      >
        {survivorName ?? 'survivor'} <ArrowRight className="h-3.5 w-3.5" />
      </Link>
    </div>
  )
}
