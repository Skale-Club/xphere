'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

export interface PageRow {
  id: string
  url: string
  status: string
  http_status: number | null
  redirect_to: string | null
  title: string | null
  word_count: number | null
  inlinks: number | null
  depth: number
  errors: number
  warnings: number
}

type Filter = 'all' | 'errors' | 'redirects' | 'broken'

function statusBadge(p: PageRow) {
  if (p.status === 'skipped') return <Badge variant="outline">robots</Badge>
  if (p.status === 'failed') return <Badge variant="danger">failed</Badge>
  const s = p.http_status ?? 0
  if (s >= 400) return <Badge variant="danger">{s}</Badge>
  if (s >= 300) return <Badge variant="warning">{s}</Badge>
  return <Badge variant="success">{s}</Badge>
}

/** `pageHrefPrefix` + page id opens that page's detail sheet. */
export function PagesTable({ pages, pageHrefPrefix }: { pages: PageRow[]; pageHrefPrefix: string }) {
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    return pages.filter((p) => {
      if (q && !p.url.toLowerCase().includes(q) && !(p.title ?? '').toLowerCase().includes(q)) return false
      if (filter === 'errors') return p.errors > 0
      if (filter === 'redirects') return !!p.redirect_to
      if (filter === 'broken') return p.status === 'failed' || (p.http_status ?? 0) >= 400
      return true
    })
  }, [pages, query, filter])

  const FILTERS: Array<[Filter, string]> = [
    ['all', 'All'],
    ['errors', 'With errors'],
    ['broken', 'Broken'],
    ['redirects', 'Redirects'],
  ]

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input placeholder="Filter by URL or title" value={query} onChange={(e) => setQuery(e.target.value)} className="max-w-xs" />
        {FILTERS.map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setFilter(key)}
            className={
              filter === key
                ? 'rounded-md bg-accent-muted px-2.5 py-1 text-xs font-medium text-accent'
                : 'rounded-md px-2.5 py-1 text-xs text-text-secondary hover:bg-bg-tertiary'
            }
          >
            {label}
          </button>
        ))}
        <span className="ml-auto text-xs text-text-tertiary">{rows.length} pages</span>
      </div>
      <div className="overflow-x-auto rounded-lg border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>URL</TableHead>
              <TableHead className="w-20">Status</TableHead>
              <TableHead className="w-24 text-right">Issues</TableHead>
              <TableHead className="w-20 text-right">Words</TableHead>
              <TableHead className="w-20 text-right">Inlinks</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((p) => (
              <TableRow key={p.id}>
                <TableCell className="max-w-[420px]">
                  <Link href={`${pageHrefPrefix}${p.id}`} scroll={false} className="block truncate text-text-primary hover:text-accent">
                    {p.url}
                  </Link>
                  <span className="block truncate text-xs text-text-tertiary">
                    {p.redirect_to ? `→ ${p.redirect_to}` : (p.title ?? '')}
                  </span>
                </TableCell>
                <TableCell>{statusBadge(p)}</TableCell>
                <TableCell className="text-right tabular-nums text-xs">
                  {p.errors > 0 && <span className="text-danger">{p.errors}E </span>}
                  {p.warnings > 0 && <span className="text-warning">{p.warnings}W</span>}
                  {p.errors === 0 && p.warnings === 0 && <span className="text-text-tertiary">—</span>}
                </TableCell>
                <TableCell className="text-right tabular-nums text-text-secondary">{p.word_count ?? '—'}</TableCell>
                <TableCell className="text-right tabular-nums text-text-secondary">{p.inlinks ?? '—'}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
