import * as React from 'react'

import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'

export const CRM_LIFECYCLE_STAGES = [
  'prospect',
  'lead',
  'opportunity',
  'customer',
  'lost',
  'archived',
] as const

export type CrmLifecycleStage = (typeof CRM_LIFECYCLE_STAGES)[number]

export interface EntityTemplateScope {
  entity: 'contact' | 'account' | 'prospect' | 'company' | string
  lifecycleStage?: CrmLifecycleStage | 'all'
  excludeLifecycleStages?: CrmLifecycleStage[]
}

function scopeAttrs(scope: EntityTemplateScope) {
  return {
    'data-crm-entity': scope.entity,
    'data-crm-lifecycle-stage': scope.lifecycleStage ?? 'all',
    'data-crm-excluded-lifecycle-stages':
      scope.excludeLifecycleStages?.join(',') ?? undefined,
  }
}

export function EntityPageTemplate({
  scope,
  children,
  className,
}: {
  scope: EntityTemplateScope
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex h-full flex-col', className)} {...scopeAttrs(scope)}>
      {children}
    </div>
  )
}

export function EntityListTemplate({
  scope,
  toolbar,
  filterBar,
  bulkActions,
  mobileList,
  desktopTable,
  pagination,
  detail,
  children,
  className,
  bodyClassName,
}: {
  scope: EntityTemplateScope
  toolbar?: React.ReactNode
  filterBar?: React.ReactNode
  bulkActions?: React.ReactNode
  mobileList?: React.ReactNode
  desktopTable?: React.ReactNode
  pagination?: React.ReactNode
  detail?: React.ReactNode
  children?: React.ReactNode
  className?: string
  bodyClassName?: string
}) {
  return (
    <div className={cn('flex h-full flex-col', className)} {...scopeAttrs(scope)}>
      {toolbar}
      <div className={cn('space-y-4 px-4 pb-2 sm:px-6 lg:px-8', bodyClassName)}>
        {children ?? (
          <>
            {filterBar}
            {bulkActions}
            {mobileList}
            {desktopTable}
            {pagination}
          </>
        )}
      </div>
      {detail}
    </div>
  )
}

export function EntityResponsivePanel({
  children,
  variant,
  className,
}: {
  children: React.ReactNode
  variant: 'mobile' | 'desktop'
  className?: string
}) {
  return (
    <div
      className={cn(
        'overflow-hidden rounded-[12px] border border-border bg-bg-secondary',
        variant === 'mobile' ? 'sm:hidden' : 'hidden sm:block',
        className,
      )}
    >
      {children}
    </div>
  )
}

export function EntityEmptyState({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn('px-4 py-10 text-center text-[13px] text-text-secondary', className)}>
      {children}
    </div>
  )
}

export function EntitySimplePagination({
  page,
  totalPages,
  total,
  onPage,
}: {
  page: number
  totalPages: number
  total: number
  onPage: (page: number) => void
}) {
  if (totalPages <= 1) return null

  return (
    <div className="flex items-center justify-between">
      <span className="text-[12px] text-text-tertiary">
        Page {page} of {totalPages} · {total} total
      </span>
      <div className="flex items-center gap-1.5">
        <Button
          size="sm"
          variant="ghost"
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
        >
          Previous
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={page >= totalPages}
          onClick={() => onPage(page + 1)}
        >
          Next
        </Button>
      </div>
    </div>
  )
}

export function EntityDetailTemplate({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return <div className={cn('flex h-full flex-col overflow-hidden', className)}>{children}</div>
}

export function EntityDetailLoadingState({
  title,
}: {
  title: React.ReactNode
}) {
  return (
    <div className="space-y-3 p-6 animate-pulse">
      {title}
      <div className="h-16 w-16 rounded-full bg-bg-tertiary" />
      <div className="h-5 w-2/3 rounded bg-bg-tertiary" />
      <div className="h-4 w-1/2 rounded bg-bg-tertiary" />
    </div>
  )
}

export function EntityDetailNotFoundState({
  title,
  children,
}: {
  title: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className="p-6 text-[13px] text-text-secondary">
      {title}
      {children}
    </div>
  )
}

export function InboxTemplate({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={cn('flex h-full min-h-0 flex-col', className)}
      {...scopeAttrs({ entity: 'inbox', lifecycleStage: 'all' })}
    >
      {children}
    </div>
  )
}

export function CompanyTemplate({
  children,
  className,
  lifecycleStage = 'all',
}: {
  children: React.ReactNode
  className?: string
  lifecycleStage?: CrmLifecycleStage | 'all'
}) {
  return (
    <div
      className={cn('flex h-full flex-col', className)}
      {...scopeAttrs({
        entity: 'account',
        lifecycleStage,
        excludeLifecycleStages: lifecycleStage === 'all' ? ['prospect'] : undefined,
      })}
    >
      {children}
    </div>
  )
}
