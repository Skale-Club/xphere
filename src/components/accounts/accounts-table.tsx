'use client'

import * as React from 'react'
import Link from 'next/link'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { Building2 } from 'lucide-react'

import { Checkbox } from '@/components/ui/checkbox'
import { Button } from '@/components/ui/button'
import { formatCurrency } from '@/lib/pipeline/format'
import { cn } from '@/lib/utils'
import type { AccountWithCounts } from '@/lib/accounts'

interface AccountsTableProps {
  rows: AccountWithCounts[]
  total: number
  page: number
  pageSize: number
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

export function AccountsTable({ rows, total, page, pageSize }: AccountsTableProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

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

  return (
    <div className="space-y-4">
      {/* Table */}
      <div className="rounded-[12px] border border-border bg-bg-secondary overflow-hidden">
        {/* Header */}
        <div className="grid grid-cols-[40px_2.5fr_1.5fr_80px_80px_100px_1.2fr_90px] items-center gap-3 px-4 py-2.5 border-b border-border-subtle bg-bg-secondary text-[11px] font-medium uppercase tracking-wide text-text-tertiary">
          <Checkbox
            checked={selected.size === rows.length && rows.length > 0}
            onCheckedChange={toggleAll}
            aria-label="Select all"
          />
          <div>Company</div>
          <div>Domain</div>
          <div>Contacts</div>
          <div>Deals</div>
          <div>Pipeline</div>
          <div>Tags</div>
          <div className="text-right">Added</div>
        </div>

        {rows.length === 0 ? (
          <div className="px-4 py-10 text-center text-[13px] text-text-secondary">
            No companies to show yet.
          </div>
        ) : (
          <div className="divide-y divide-border-subtle">
            {rows.map((row) => (
              <div
                key={row.id}
                className={cn(
                  'grid grid-cols-[40px_2.5fr_1.5fr_80px_80px_100px_1.2fr_90px] items-center gap-3 px-4 py-3',
                  'transition-colors hover:bg-bg-tertiary/40',
                )}
              >
                {/* Checkbox */}
                <div onClick={(e) => e.stopPropagation()}>
                  <Checkbox
                    checked={selected.has(row.id)}
                    onCheckedChange={() => toggleRow(row.id)}
                    aria-label={`Select ${row.name}`}
                  />
                </div>

                {/* Company name */}
                <div className="flex items-center gap-2 min-w-0">
                  <Building2 className="h-3.5 w-3.5 text-text-tertiary shrink-0" />
                  <Link
                    href={`/accounts/${row.id}`}
                    className="truncate text-[13px] font-medium text-text-primary hover:text-accent transition-colors"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {row.name}
                  </Link>
                </div>

                {/* Domain */}
                <div className="truncate text-[12.5px] text-text-secondary">
                  {row.domain || '—'}
                </div>

                {/* Contact count */}
                <div className="text-[12.5px] text-text-secondary tabular-nums">
                  {row.contact_count}
                </div>

                {/* Open opportunity count */}
                <div className="text-[12.5px] text-text-secondary tabular-nums">
                  {row.open_opportunity_count}
                </div>

                {/* Pipeline value */}
                <div className="text-[12.5px] text-text-secondary tabular-nums">
                  {row.pipeline_value > 0 ? formatCurrency(row.pipeline_value) : '—'}
                </div>

                {/* Tags */}
                <div className="flex flex-wrap gap-1 overflow-hidden">
                  {(row.tags ?? []).slice(0, 2).map((tag) => (
                    <span
                      key={tag}
                      className="rounded-full bg-accent-muted text-accent text-[10.5px] px-2 py-0.5 font-medium"
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

                {/* Created at */}
                <div className="text-right text-[11.5px] text-text-tertiary">
                  {relativeTime(row.created_at)}
                </div>
              </div>
            ))}
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
