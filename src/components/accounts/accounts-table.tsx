'use client'

import * as React from 'react'
import Link from 'next/link'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { Building2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { formatCurrency } from '@/lib/pipeline/format'
import { CustomFieldsFilterBar } from '@/components/custom-fields/custom-fields-filter-bar'
import type { CustomFieldDefinitionRow } from '@/app/(dashboard)/settings/custom-fields/actions'
import { FIELD_RENDER_CONFIG } from '@/lib/custom-fields/render-config'
import type { CustomFieldType } from '@/types/database'
import { cn } from '@/lib/utils'
import type { AccountRow } from '@/lib/accounts'
import { AccountsBulkActions } from './accounts-bulk-actions'
import { Badge } from '@/components/ui/badge'
import { useBreadcrumbOverride } from '@/components/layout/breadcrumb-override-context'
import { SortableColumnHeader } from '@/components/data-table/sortable-column-header'

// Extended row type that includes counts populated by detail queries.
// The list action (getAccounts) returns AccountRow[]; count fields default to 0
// when not present. Plan 66-02+ will update the action to return full counts.
type AccountWithListCounts = AccountRow & {
  contact_count?: number
  open_opportunity_count?: number
  pipeline_value?: number | null
}

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  const m = Math.round(ms / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.round(h / 24)
  if (d < 30) return `${d}d ago`
  return new Date(iso).toLocaleDateString()
}

interface AccountsTableProps {
  rows: AccountWithListCounts[]
  total: number
  page: number
  pageSize: number
  visibleDefs?: CustomFieldDefinitionRow[]
  filterableDefs?: CustomFieldDefinitionRow[]
  activeCfFilters?: Record<string, string>
}

export function AccountsTable({
  rows,
  total,
  page,
  pageSize,
  visibleDefs = [],
  filterableDefs = [],
  activeCfFilters = {},
}: AccountsTableProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const { setSuffix } = useBreadcrumbOverride()

  React.useEffect(() => {
    setSuffix(<Badge variant="secondary">{total}</Badge>)
    return () => setSuffix(null)
  }, [total, setSuffix])

  const [selected, setSelected] = React.useState<Set<string>>(new Set())

  // Reset selection when rows change
  React.useEffect(() => {
    setSelected(new Set())
  }, [rows])

  function setParam(key: string, value: string | null) {
    const params = new URLSearchParams(searchParams.toString())
    if (value) params.set(key, value)
    else params.delete(key)
    if (key !== 'page') params.delete('page')
    router.replace(`${pathname}?${params.toString()}`)
  }

  function toggleRow(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleAll() {
    if (selected.size === rows.length && rows.length > 0) {
      setSelected(new Set())
    } else {
      setSelected(new Set(rows.map((r) => r.id)))
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  const gridTemplate = `40px 2.5fr 1.5fr 80px 80px 100px 1.2fr${visibleDefs.map(() => ' 1fr').join('')} 90px`

  return (
    <div className="space-y-4 px-4 sm:px-6 lg:px-8 pb-2">
      {filterableDefs.length > 0 && (
        <CustomFieldsFilterBar
          filterableDefs={filterableDefs}
          activeFilters={activeCfFilters}
          onChange={(key, value) => setParam(`cff_${key}`, value)}
        />
      )}

      {/* Bulk-actions bar | visible when 1+ rows are selected */}
      {selected.size > 0 && (
        <AccountsBulkActions
          selected={selected}
          onClearSelection={() => setSelected(new Set())}
          onRefresh={() => router.refresh()}
        />
      )}

      {/* Table */}
      <div className="rounded-[12px] border border-border bg-bg-secondary overflow-hidden">
        {/* Header */}
        <div
          className="grid items-center gap-3 px-4 py-2.5 border-b border-border-subtle bg-bg-secondary text-[11px] font-medium uppercase tracking-wide text-text-tertiary"
          style={{ gridTemplateColumns: gridTemplate }}
        >
          <Checkbox
            checked={selected.size === rows.length && rows.length > 0}
            onCheckedChange={toggleAll}
            aria-label="Select all"
          />
          <SortableColumnHeader column="name" label="Company" />
          <SortableColumnHeader column="domain" label="Domain" />
          <div className="tabular-nums">Contacts</div>
          <div className="tabular-nums">Deals</div>
          <div className="tabular-nums">Pipeline</div>
          <div>Tags</div>
          {visibleDefs.map((def) => (
            <div key={def.id}>{def.label}</div>
          ))}
          <div className="text-right">
            <SortableColumnHeader column="created_at" label="Added" />
          </div>
        </div>

        {/* Body */}
        {rows.length === 0 ? (
          <div className="px-4 py-10 text-center text-[13px] text-text-secondary">
            No companies to show yet.
          </div>
        ) : (
          <div className="divide-y divide-border-subtle">
            {rows.map((row) => {
              return (
                <div
                  key={row.id}
                  className={cn(
                    'grid items-center gap-3 px-4 py-3',
                    'transition-colors duration-150 hover:bg-bg-tertiary/40',
                  )}
                  style={{ gridTemplateColumns: gridTemplate }}
                >
                  {/* Checkbox */}
                  <div onClick={(e) => e.stopPropagation()}>
                    <Checkbox
                      checked={selected.has(row.id)}
                      onCheckedChange={() => toggleRow(row.id)}
                      aria-label={`Select ${row.name ?? 'company'}`}
                    />
                  </div>

                  {/* Company name | link to detail page */}
                  <Link
                    href={`/accounts/${row.id}`}
                    className="flex items-center gap-2 min-w-0 group"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Building2 className="h-3.5 w-3.5 shrink-0 text-text-tertiary group-hover:text-accent transition-colors" />
                    <span className="truncate text-[13px] font-medium text-text-primary group-hover:text-accent transition-colors">
                      {row.name ?? <span className="italic text-text-tertiary">Unnamed</span>}
                    </span>
                  </Link>

                  {/* Domain */}
                  <div className="truncate text-[12.5px] text-text-secondary">
                    {row.domain ?? '|'}
                  </div>

                  {/* Contacts count */}
                  <div className="text-[12.5px] text-text-secondary tabular-nums">
                    {row.contact_count ?? '|'}
                  </div>

                  {/* Open deals count */}
                  <div className="text-[12.5px] text-text-secondary tabular-nums">
                    {row.open_opportunity_count ?? '|'}
                  </div>

                  {/* Pipeline value */}
                  <div className="text-[12.5px] text-text-secondary tabular-nums">
                    {row.pipeline_value ? formatCurrency(row.pipeline_value) : '|'}
                  </div>

                  {/* Tags | up to 2 chips + remainder */}
                  <div className="flex flex-wrap gap-1 overflow-hidden">
                    {(row.tags ?? []).slice(0, 2).map((tag) => (
                      <span
                        key={tag}
                        className="inline-flex items-center rounded-full bg-accent-muted px-2 py-0.5 text-[10.5px] font-medium text-accent"
                      >
                        {tag}
                      </span>
                    ))}
                    {(row.tags ?? []).length > 2 && (
                      <span className="text-[10.5px] text-text-tertiary">
                        +{(row.tags ?? []).length - 2}
                      </span>
                    )}
                  </div>

                  {/* Custom field columns */}
                  {visibleDefs.map((def) => {
                    const cf = (row.custom_fields ?? {}) as Record<string, unknown>
                    const val = cf[def.key]
                    const config = FIELD_RENDER_CONFIG[def.type as CustomFieldType]
                    const display = val !== undefined && val !== null ? config.displayFormatter(val) : '|'
                    return (
                      <div key={def.id} className="truncate text-[12.5px] text-text-secondary">
                        {display}
                      </div>
                    )
                  })}

                  {/* Created at */}
                  <div className="text-right text-[11.5px] text-text-tertiary">
                    {relativeTime(row.created_at)}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <span className="text-[12px] text-text-tertiary">
            Page {page} of {totalPages} · {total} total
          </span>
          <div className="flex items-center gap-1.5">
            <Button
              size="sm"
              variant="ghost"
              disabled={page <= 1}
              onClick={() => setParam('page', String(page - 1))}
            >
              Previous
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={page >= totalPages}
              onClick={() => setParam('page', String(page + 1))}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
