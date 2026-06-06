import * as React from 'react'

import { cn } from '@/lib/utils'

interface PageHeaderProps {
  /** Kept for API compatibility | no longer rendered (header breadcrumb shows it). */
  eyebrow?: string
  /** Kept for API compatibility | no longer rendered. */
  eyebrowIcon?: React.ComponentType<{ className?: string }>
  /** Kept for API compatibility | no longer rendered. */
  title?: React.ReactNode
  /** Kept for API compatibility | no longer rendered. */
  description?: React.ReactNode
  /** Right-aligned action area (buttons, switches, etc.). Still rendered. */
  actions?: React.ReactNode
  /** Kept for API compatibility | no longer rendered. */
  back?: { href: string; label: string }
  className?: string
}

/**
 * Page header. The title/description/eyebrow/back used to render here, but the
 * top-bar breadcrumb already shows the page name + icon, so rendering them
 * again on every screen was redundant. This component now only renders the
 * right-aligned `actions` row. The other props are accepted for backward
 * compatibility (so we don't have to edit 68 pages).
 */
export function PageHeader({
  actions,
  className,
  // intentionally unused | kept for backward compatibility:
  back: _back,
  eyebrow: _eyebrow,
  eyebrowIcon: _eyebrowIcon,
  title: _title,
  description: _description,
}: PageHeaderProps) {
  if (!actions) return null

  return (
    <div className={cn('animate-fade-in flex flex-col gap-3', className)}>
      {actions && (
        <div className="flex flex-wrap items-center justify-end gap-2">{actions}</div>
      )}
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
  // All pages are full-width; `size` prop is kept for API compatibility
  // but no longer constrains horizontal layout. Use card widths inside
  // pages for form readability instead of constraining the whole page.
  const maxW = 'max-w-none'
  void size

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
