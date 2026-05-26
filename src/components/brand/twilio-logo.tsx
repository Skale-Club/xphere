import * as React from 'react'

import { cn } from '@/lib/utils'

interface TwilioLogoProps extends React.SVGAttributes<SVGSVGElement> {
  /** Tailwind size class (default applies via parent). */
  className?: string
  /**
   * When true, renders the red brand color (#F22F46) instead of inheriting
   * currentColor. Useful in the credentials step to make the mark instantly
   * recognizable.
   */
  brandColor?: boolean
  /** Optional title for assistive tech. */
  title?: string
}

/**
 * Twilio brand mark — official circle + four-dot pattern (simple-icons,
 * matches the marketing site favicon).
 */
export function TwilioLogo({
  className,
  brandColor = false,
  title = 'Twilio',
  ...props
}: TwilioLogoProps) {
  return (
    <svg
      role="img"
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
      aria-label={title}
      className={cn(brandColor ? 'text-[#F22F46]' : undefined, className)}
      fill="currentColor"
      {...props}
    >
      <title>{title}</title>
      <path d="M12 0C5.376 0 0 5.376 0 12s5.376 12 12 12 12-5.376 12-12S18.624 0 12 0zm0 21.6A9.6 9.6 0 1121.6 12 9.6 9.6 0 0112 21.6zm5.952-11.808a2.4 2.4 0 11-2.4-2.4 2.4 2.4 0 012.4 2.4zm0 4.32a2.4 2.4 0 11-2.4-2.4 2.4 2.4 0 012.4 2.4zm-4.32 0a2.4 2.4 0 11-2.4-2.4 2.4 2.4 0 012.4 2.4zm0-4.32a2.4 2.4 0 11-2.4-2.4 2.4 2.4 0 012.4 2.4z" />
    </svg>
  )
}
