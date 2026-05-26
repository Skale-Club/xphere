'use client'

import { useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronRight, ChevronUp, ChevronDown, Search } from 'lucide-react'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Input } from '@/components/ui/input'
import type { OrgRow } from '@/app/(admin)/admin/_actions/get-all-orgs'

type SortKey = 'name' | 'created_at'
type SortDir = 'asc' | 'desc'

function SortIcon({ column, sortKey, sortDir }: { column: SortKey; sortKey: SortKey; sortDir: SortDir }) {
  if (sortKey !== column) return <ChevronDown className="h-3 w-3 opacity-30 ml-1 inline-block" />
  return sortDir === 'asc'
    ? <ChevronUp className="h-3 w-3 ml-1 inline-block text-accent" />
    : <ChevronDown className="h-3 w-3 ml-1 inline-block text-accent" />
}

export function OrgsTable({ orgs }: { orgs: OrgRow[] }) {
  const router = useRouter()
  const [search, setSearch] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('created_at')
  const [sortDir, setSortDir] = useState<SortDir>('desc')

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortKey(key)
      setSortDir('asc')
    }
  }

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    return orgs.filter(o =>
      o.name.toLowerCase().includes(q) || o.slug.toLowerCase().includes(q)
    )
  }, [orgs, search])

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      const va = a[sortKey]
      const vb = b[sortKey]
      const cmp = va < vb ? -1 : va > vb ? 1 : 0
      return sortDir === 'asc' ? cmp : -cmp
    })
  }, [filtered, sortKey, sortDir])

  if (orgs.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <p className="text-text-primary font-medium text-sm">No organizations yet</p>
        <p className="text-text-secondary text-sm mt-1">There are no tenant organizations in the system yet.</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="flex items-center gap-2 text-xs text-text-tertiary">
          <span className="rounded-full border border-border px-2 py-0.5">{orgs.length} orgs</span>
          <span className="rounded-full border border-border px-2 py-0.5">{orgs.filter(o => o.is_active).length} active</span>
          <span className="rounded-full border border-border px-2 py-0.5">{orgs.filter(o => !o.is_active).length} inactive</span>
        </div>
        <div className="relative w-full sm:w-[280px] sm:ml-auto">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-text-tertiary" />
          <Input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search organizations…"
            className="pl-8 bg-bg-secondary border-border-subtle text-text-primary placeholder:text-text-tertiary text-sm h-9 focus-visible:ring-ring/40"
          />
        </div>
      </div>

      {sorted.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <p className="text-text-secondary text-sm">No organizations match your search.</p>
        </div>
      ) : (
        <div className="rounded-lg border border-border-subtle overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="border-border-subtle bg-bg-secondary hover:bg-bg-secondary">
                <TableHead
                  className="text-text-tertiary font-medium text-xs cursor-pointer select-none"
                  onClick={() => toggleSort('name')}
                >
                  Name <SortIcon column="name" sortKey={sortKey} sortDir={sortDir} />
                </TableHead>
                <TableHead className="text-text-tertiary font-medium text-xs">Slug</TableHead>
                <TableHead className="text-text-tertiary font-medium text-xs">Status</TableHead>
                <TableHead
                  className="text-text-tertiary font-medium text-xs cursor-pointer select-none"
                  onClick={() => toggleSort('created_at')}
                >
                  Created <SortIcon column="created_at" sortKey={sortKey} sortDir={sortDir} />
                </TableHead>
                <TableHead className="text-text-tertiary font-medium text-xs text-right">Members</TableHead>
                <TableHead className="text-text-tertiary font-medium text-xs text-right">Contacts</TableHead>
                <TableHead className="text-text-tertiary font-medium text-xs text-right">Calls</TableHead>
                <TableHead className="text-text-tertiary font-medium text-xs text-right">Conversations</TableHead>
                <TableHead className="w-8" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {sorted.map((org) => (
                <TableRow
                  key={org.id}
                  className="border-border-subtle bg-bg-primary hover:bg-bg-tertiary cursor-pointer transition-colors duration-100"
                  onClick={() => router.push(`/admin/orgs/${org.id}`)}
                >
                  <TableCell className="text-text-primary text-sm font-medium">{org.name}</TableCell>
                  <TableCell className="text-text-secondary text-sm font-mono text-xs">{org.slug}</TableCell>
                  <TableCell>
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium border ${
                      org.is_active
                        ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20'
                        : 'bg-bg-tertiary text-text-tertiary border-border'
                    }`}>
                      {org.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </TableCell>
                  <TableCell className="text-text-secondary text-sm">
                    {new Date(org.created_at).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}
                  </TableCell>
                  <TableCell className="text-text-secondary text-sm text-right tabular-nums">{org.members_count}</TableCell>
                  <TableCell className="text-text-secondary text-sm text-right tabular-nums">{org.contacts_count}</TableCell>
                  <TableCell className="text-text-secondary text-sm text-right tabular-nums">{org.calls_count}</TableCell>
                  <TableCell className="text-text-secondary text-sm text-right tabular-nums">{org.conversations_count}</TableCell>
                  <TableCell>
                    <ChevronRight className="h-4 w-4 text-text-tertiary" />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}
