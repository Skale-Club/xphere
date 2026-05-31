'use client'

import * as React from 'react'
import Link from 'next/link'
import { ChevronRight } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/**
 * CTAButton — shared marketing call-to-action.
 *
 * Visual: indigo gradient + subtle shine sweep (defined as `.btn-cta` in globals.css).
 * Interaction: chevron icon is hidden by default and slides in from the left on hover.
 *
 * Use this for any "primary action" button on landing / marketing surfaces so the
 * look-and-feel stays consistent. For inline app actions, prefer the base `Button`.
 *
 * Examples:
 *   <CTAButton href="/signup">Start</CTAButton>
 *   <CTAButton href="/demo" icon={ArrowRight}>Book demo</CTAButton>
 *   <CTAButton onClick={...}>Continue</CTAButton>
 */

type IconComponent = React.ComponentType<{ className?: string }>

interface BaseProps {
  children: React.ReactNode
  /** Optional icon override (defaults to ChevronRight). */
  icon?: IconComponent
  /** Extra className merged onto the inner Button. */
  className?: string
  /** Button size — defaults to "lg" (matches landing CTAs). */
  size?: 'sm' | 'default' | 'md' | 'lg'
}

interface LinkProps extends BaseProps {
  href: string
  onClick?: never
  type?: never
}

interface ActionProps extends BaseProps {
  href?: never
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void
  type?: 'button' | 'submit' | 'reset'
}

type CTAButtonProps = LinkProps | ActionProps

export function CTAButton({
  children,
  icon: Icon = ChevronRight,
  className,
  size = 'lg',
  ...rest
}: CTAButtonProps) {
  const isLink = 'href' in rest && !!rest.href

  const inner = (
    <>
      {children}
      <span
        className={cn(
          'inline-flex items-center overflow-hidden',
          'w-0 ml-0 opacity-0 -translate-x-2',
          'group-hover:w-5 group-hover:ml-1 group-hover:opacity-100 group-hover:translate-x-0',
          'transition-all duration-300 ease-out',
        )}
        aria-hidden
      >
        <Icon className="h-4 w-4 shrink-0" />
      </span>
    </>
  )

  return (
    <Button
      asChild={isLink}
      size={size}
      type={!isLink && 'type' in rest ? rest.type : undefined}
      onClick={!isLink && 'onClick' in rest ? rest.onClick : undefined}
      className={cn(
        'px-8 gap-0 btn-cta group',
        'shadow-lg shadow-indigo-500/40 hover:shadow-indigo-500/60',
        'transition-shadow duration-300',
        className,
      )}
    >
      {isLink ? <Link href={rest.href}>{inner}</Link> : inner}
    </Button>
  )
}
