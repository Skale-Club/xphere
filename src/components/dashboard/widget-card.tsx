import * as React from 'react'
import Link from 'next/link'
import { ArrowRight } from 'lucide-react'

import { cn } from '@/lib/utils'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

interface WidgetCardProps {
  title: React.ReactNode
  /** Small icon next to the title */
  icon?: React.ComponentType<{ className?: string }>
  /** Optional "View all" link rendered on the header right side */
  href?: string
  /** Label for the link (default: "View all") */
  hrefLabel?: string
  /** Extra header content rendered between the title and the View-all link */
  headerExtra?: React.ReactNode
  /** Apply additional classes to outer Card */
  className?: string
  /** Apply additional classes to the body content wrapper */
  contentClassName?: string
  /** Apply additional classes to the header wrapper */
  headerClassName?: string
  children: React.ReactNode
}

/**
 * Standard wrapper card used by every dashboard widget. Provides a
 * consistent header (icon + title + optional "View all" link) and body
 * spacing. Body content is whatever the widget chooses to render — a list,
 * a chart, a grid, etc.
 */
export function WidgetCard({
  title,
  icon: Icon,
  href,
  hrefLabel = 'View all',
  headerExtra,
  className,
  contentClassName,
  headerClassName,
  children,
}: WidgetCardProps) {
  return (
    <Card className={cn('flex h-full flex-col', className)}>
      <CardHeader
        className={cn(
          'flex flex-row items-center justify-between gap-3 space-y-0 pb-3',
          headerClassName,
        )}
      >
        <CardTitle className="flex items-center gap-2 text-[13.5px]">
          {Icon && <Icon className="h-3.5 w-3.5 text-text-tertiary" />}
          <span>{title}</span>
        </CardTitle>
        <div className="flex items-center gap-2">
          {headerExtra}
          {href && (
            <Link
              href={href}
              className="group inline-flex items-center gap-0.5 rounded-[5px] px-1.5 py-1 text-[11.5px] font-medium text-text-tertiary transition-colors hover:text-text-primary"
            >
              {hrefLabel}
              <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" />
            </Link>
          )}
        </div>
      </CardHeader>
      <CardContent className={cn('flex-1 pt-0', contentClassName)}>{children}</CardContent>
    </Card>
  )
}
