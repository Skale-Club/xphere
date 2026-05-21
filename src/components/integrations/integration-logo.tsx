'use client'

// SEED-042 | IntegrationLogo
// Renders a brand SVG when available, falling back to a colored letter avatar
// when the SVG file is missing. Loaded as a client component so we can swap
// to the fallback on <img> error.

import { useState } from 'react'
import { cn } from '@/lib/utils'
import type { IntegrationLogo as LogoSpec } from '@/lib/integrations/registry'

interface IntegrationLogoProps {
  logo: LogoSpec
  name: string
  size?: number
  className?: string
}

export function IntegrationLogo({
  logo,
  name,
  size = 36,
  className,
}: IntegrationLogoProps) {
  const [failed, setFailed] = useState(!logo.path)
  const inner = size - 12

  return (
    <div
      className={cn(
        'flex shrink-0 items-center justify-center rounded-[8px] border border-border-subtle bg-bg-tertiary overflow-hidden',
        className,
      )}
      style={{ width: size, height: size }}
    >
      {!failed && logo.path ? (
        // Letting <img> handle the error so missing brand assets gracefully
        // degrade to the letter avatar.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={logo.path}
          alt={name}
          width={inner}
          height={inner}
          className="object-contain"
          onError={() => setFailed(true)}
        />
      ) : (
        <div
          className={cn(
            'flex h-full w-full items-center justify-center text-white font-semibold',
            logo.color,
          )}
          style={{ fontSize: Math.round(size * 0.45) }}
          aria-label={name}
        >
          {logo.letter}
        </div>
      )}
    </div>
  )
}
