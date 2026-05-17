import * as React from 'react'
import Link from 'next/link'
import { ChevronLeft, Sparkles } from 'lucide-react'

import { cn } from '@/lib/utils'

interface PageHeaderProps {
  /** Small uppercase eyebrow above the title (defaults to "Workspace") */
  eyebrow?: string
  /** Icon shown next to the eyebrow */
  eyebrowIcon?: React.ComponentType<{ className?: string }>
  /** Page title — supports rich nodes (badges, etc.) */
  title: React.ReactNode
  /** Secondary description */
  description?: React.ReactNode
  /** Right-aligned action area (buttons, switches, etc.) */
  actions?: React.ReactNode
  /** Optional back link rendered above the eyebrow */
  back?: { href: string; label: string }
  className?: string
}

/**
 * Consistent page hero used across dashboard screens.
 * Pairs with mx-auto max-w-7xl wrapper.
 */
export function PageHeader({
  eyebrow = 'Workspace',
  eyebrowIcon: EyebrowIcon = Sparkles,
  title,
  description,
  actions,
  back,
  className,
}: PageHeaderProps) {
  return (
    <div className={cn('animate-fade-in flex flex-col gap-3', className)}>
      {back && (
        <Link
          href={back.href}
          className="group inline-flex w-fit items-center gap-1 text-[12.5px] font-medium text-text-tertiary transition-colors hover:text-text-secondary"
        >
          <ChevronLeft className="h-3.5 w-3.5 transition-transform group-hover:-translate-x-0.5" />
          {back.label}
        </Link>
      )}

      <div className="flex items-center gap-2 text-[12px] font-medium uppercase tracking-[0.08em] text-text-tertiary">
        <EyebrowIcon className="h-3.5 w-3.5 text-accent" />
        <span>{eyebrow}</span>
      </div>

      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h1 className="flex items-center gap-3 text-[28px] font-semibold tracking-tight text-text-primary sm:text-[32px]">
            {title}
          </h1>
          {description && (
            <p className="mt-1 max-w-2xl text-[14px] text-text-secondary">{description}</p>
          )}
        </div>
        {actions && (
          <div className="flex flex-wrap items-center gap-2">{actions}</div>
        )}
      </div>
    </div>
  )
}

/**
 * Standard page container that pairs with PageHeader.
 */
export function PageContainer({
  children,
  className,
  size = 'wide',
}: {
  children: React.ReactNode
  className?: string
  size?: 'narrow' | 'wide' | 'full'
}) {
  const maxW =
    size === 'narrow' ? 'max-w-4xl' : size === 'full' ? 'max-w-none' : 'max-w-7xl'

  return (
    <div
      className={cn(
        'mx-auto w-full px-4 sm:px-6 lg:px-8 py-8 space-y-8',
        maxW,
        className,
      )}
    >
      {children}
    </div>
  )
}
