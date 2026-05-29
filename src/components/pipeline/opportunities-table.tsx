'use client'

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { ArrowUpDown, Trash2 } from 'lucide-react'

import { Checkbox } from '@/components/ui/checkbox'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { formatCurrency, relativeTime } from '@/lib/pipeline/format'
import { formatPhoneDisplay } from '@/lib/phone-numbers/format'
import {
  deleteOpportunity,
  type OpportunityWithContact,
} from '@/app/(dashboard)/pipeline/actions'

type SortKey = 'title' | 'value' | 'updated_at' | 'stage'
type SortDir = 'asc' | 'desc'

interface OpportunitiesTableProps {
  opportunities: OpportunityWithContact[]
}

export function OpportunitiesTable({ opportunities }: OpportunitiesTableProps) {
  const router = useRouter()
  const [selected, setSelected] = React.useState<Set<string>>(new Set())
  const [sortKey, setSortKey] = React.useState<SortKey>('updated_at')
  const [sortDir, setSortDir] = React.useState<SortDir>('desc')

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else {
      setSortKey(key)
      setSortDir('asc')
    }
  }

  const sorted = React.useMemo(() => {
    const arr = [...opportunities]
    arr.sort((a, b) => {
      let cmp = 0
      switch (sortKey) {
        case 'title':
          cmp = (a.title ?? '').localeCompare(b.title ?? '')
          break
        case 'value':
          cmp = Number(a.value ?? 0) - Number(b.value ?? 0)
          break
        case 'updated_at':
          cmp = new Date(a.updated_at).getTime() - new Date(b.updated_at).getTime()
          break
        case 'stage':
          cmp = (a.stage?.name ?? '').localeCompare(b.stage?.name ?? '')
          break
      }
      return sortDir === 'asc' ? cmp : -cmp
    })
    return arr
  }, [opportunities, sortKey, sortDir])

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleAll() {
    if (selected.size === sorted.length) setSelected(new Set())
    else setSelected(new Set(sorted.map((o) => o.id)))
  }

  async function handleBulkDelete() {
    if (selected.size === 0) return
    if (!confirm(`Delete ${selected.size} opportunit${selected.size === 1 ? 'y' : 'ies'}?`)) return
    let errors = 0
    for (const id of selected) {
      const res = await deleteOpportunity(id)
      if (res && 'error' in res && res.error) errors++
    }
    if (errors > 0) toast.error(`${errors} delete${errors === 1 ? '' : 's'} failed`)
    else toast.success(`Deleted ${selected.size}`)
    setSelected(new Set())
    router.refresh()
  }

  if (opportunities.length === 0) {
    return (
      <div className="rounded-[12px] border border-border bg-bg-secondary p-10 text-center">
        <h2 className="text-[14px] font-semibold text-text-primary">No opportunities</h2>
        <p className="mt-1 text-[12.5px] text-text-secondary">
          Use the Kanban or "New opportunity" to create your first deal.
        </p>
      </div>
    )
  }

  return (
    <div className="rounded-[12px] border border-border bg-bg-secondary overflow-hidden">
      {selected.size > 0 && (
        <div className="flex items-center justify-between bg-accent-muted/30 border-b border-border-subtle px-4 py-2">
          <span className="text-[12.5px] text-accent">{selected.size} selected</span>
          <Button size="sm" variant="ghost" onClick={handleBulkDelete} className="text-rose-400 hover:text-rose-300">
            <Trash2 className="h-3.5 w-3.5" /> Delete
          </Button>
        </div>
      )}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-10">
              <Checkbox
                checked={selected.size === sorted.length && sorted.length > 0}
                onCheckedChange={toggleAll}
                aria-label="Select all"
              />
            </TableHead>
            <TableHead>
              <button
                onClick={() => toggleSort('title')}
                className="inline-flex items-center gap-1 text-[12px] uppercase tracking-wide text-text-tertiary hover:text-text-primary"
              >
                Title <ArrowUpDown className="h-3 w-3" />
              </button>
            </TableHead>
            <TableHead>Contact</TableHead>
            <TableHead>
              <button
                onClick={() => toggleSort('stage')}
                className="inline-flex items-center gap-1 text-[12px] uppercase tracking-wide text-text-tertiary hover:text-text-primary"
              >
                Stage <ArrowUpDown className="h-3 w-3" />
              </button>
            </TableHead>
            <TableHead className="text-right">
              <button
                onClick={() => toggleSort('value')}
                className="inline-flex items-center gap-1 text-[12px] uppercase tracking-wide text-text-tertiary hover:text-text-primary"
              >
                Value <ArrowUpDown className="h-3 w-3" />
              </button>
            </TableHead>
            <TableHead>
              <button
                onClick={() => toggleSort('updated_at')}
                className="inline-flex items-center gap-1 text-[12px] uppercase tracking-wide text-text-tertiary hover:text-text-primary"
              >
                Updated <ArrowUpDown className="h-3 w-3" />
              </button>
            </TableHead>
            <TableHead>Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sorted.map((o) => (
            <TableRow key={o.id} className="cursor-pointer hover:bg-bg-tertiary/30">
              <TableCell onClick={(e) => e.stopPropagation()}>
                <Checkbox
                  checked={selected.has(o.id)}
                  onCheckedChange={() => toggle(o.id)}
                  aria-label={`Select ${o.title}`}
                />
              </TableCell>
              <TableCell className="font-medium">
                <Link href={`/pipeline/${o.id}`} className="hover:underline text-text-primary">
                  {o.title}
                </Link>
              </TableCell>
              <TableCell className="text-text-secondary">
                {o.contact?.name ?? (o.contact?.phone ? formatPhoneDisplay(o.contact.phone) : '-')}
              </TableCell>
              <TableCell>
                <span className="inline-flex items-center gap-1.5 text-[12px]">
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ backgroundColor: o.stage?.color ?? '#6366F1' }}
                  />
                  {o.stage?.name ?? '-'}
                </span>
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {formatCurrency(Number(o.value), o.currency)}
              </TableCell>
              <TableCell className="text-text-tertiary text-[12px]">
                {relativeTime(o.updated_at)}
              </TableCell>
              <TableCell>
                <StatusPill status={o.status} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

function StatusPill({ status }: { status: string }) {
  const styles =
    status === 'won'
      ? 'bg-emerald-500/15 text-emerald-400 ring-emerald-500/20'
      : status === 'lost'
        ? 'bg-rose-500/10 text-rose-400 ring-rose-500/20'
        : 'bg-bg-tertiary text-text-secondary ring-border-subtle'
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 capitalize ${styles}`}
    >
      {status}
    </span>
  )
}
