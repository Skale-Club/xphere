import { Store } from 'lucide-react'

import { cn } from '@/lib/utils'

type Platform = 'meta' | 'google' | 'google_business'

function GoogleG({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden>
      <path fill="#FFC107" d="M43.6 20.1H42V20H24v8h11.3c-1.6 4.7-6.1 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 8 3l5.7-5.7C34 6.1 29.3 4 24 4 13 4 4 13 4 24s9 20 20 20 20-9 20-20c0-1.3-.1-2.7-.4-3.9z" />
      <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 8 3l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2A11.9 11.9 0 0 1 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.1H42V20H24v8h11.3a12 12 0 0 1-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.7-.4-3.9z" />
    </svg>
  )
}

const LABEL: Record<Platform, string> = { meta: 'Meta Ads', google: 'Google Ads', google_business: 'Google Business Profile' }

/** Square platform tile (Meta / Google / Google Business) for lists of ad changes. */
export function PlatformMark({ platform, className }: { platform: Platform; className?: string }) {
  return (
    <span
      className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border-subtle bg-bg-tertiary', className)}
      title={LABEL[platform]}
      aria-label={LABEL[platform]}
      role="img"
    >
      {platform === 'meta' ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src="/logos/meta.svg" alt="" className="h-[18px] w-[18px]" />
      ) : platform === 'google' ? (
        <GoogleG className="h-[18px] w-[18px]" />
      ) : (
        <span className="relative">
          <Store className="h-[17px] w-[17px] text-[#4285F4]" />
          <GoogleG className="absolute -bottom-1.5 -right-1.5 h-2.5 w-2.5 rounded-full bg-bg-tertiary" />
        </span>
      )}
    </span>
  )
}
