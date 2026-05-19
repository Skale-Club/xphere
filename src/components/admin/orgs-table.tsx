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
    ? <ChevronUp className="h-3 w-3 ml-1 inline-block text-red-400" />
    : <ChevronDown className="h-3 w-3 ml-1 inline-block text-red-400" />
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
        <p className="text-[#FAFAFA] font-medium text-sm">No organizations yet</p>
        <p className="text-[#A1A1AA] text-sm mt-1">There are no tenant organizations in the system yet.</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <div className="relative w-[280px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[#71717A]" />
          <Input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search organizations…"
            className="pl-8 bg-[#111113] border-[#2A2A2F] text-[#FAFAFA] placeholder:text-[#71717A] text-sm h-9 focus-visible:ring-red-500/40"
          />
        </div>
      </div>

      {sorted.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <p className="text-[#A1A1AA] text-sm">No organizations match your search.</p>
        </div>
      ) : (
        <div className="rounded-lg border border-[#2A2A2F] overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="border-[#2A2A2F] bg-[#111113] hover:bg-[#111113]">
                <TableHead
                  className="text-[#71717A] font-medium text-xs cursor-pointer select-none"
                  onClick={() => toggleSort('name')}
                >
                  Name <SortIcon column="name" sortKey={sortKey} sortDir={sortDir} />
                </TableHead>
                <TableHead className="text-[#71717A] font-medium text-xs">Slug</TableHead>
                <TableHead
                  className="text-[#71717A] font-medium text-xs cursor-pointer select-none"
                  onClick={() => toggleSort('created_at')}
                >
                  Created <SortIcon column="created_at" sortKey={sortKey} sortDir={sortDir} />
                </TableHead>
                <TableHead className="text-[#71717A] font-medium text-xs text-right">Members</TableHead>
                <TableHead className="text-[#71717A] font-medium text-xs text-right">Contacts</TableHead>
                <TableHead className="text-[#71717A] font-medium text-xs text-right">Calls</TableHead>
                <TableHead className="text-[#71717A] font-medium text-xs text-right">Conversations</TableHead>
                <TableHead className="w-8" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {sorted.map((org) => (
                <TableRow
                  key={org.id}
                  className="border-[#2A2A2F] bg-[#0A0A0B] hover:bg-[#1A1A1D] cursor-pointer transition-colors duration-100"
                  onClick={() => router.push(`/admin/orgs/${org.id}`)}
                >
                  <TableCell className="text-[#FAFAFA] text-sm font-medium">{org.name}</TableCell>
                  <TableCell className="text-[#A1A1AA] text-sm font-mono text-xs">{org.slug}</TableCell>
                  <TableCell className="text-[#A1A1AA] text-sm">
                    {new Date(org.created_at).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}
                  </TableCell>
                  <TableCell className="text-[#A1A1AA] text-sm text-right tabular-nums">{org.members_count}</TableCell>
                  <TableCell className="text-[#A1A1AA] text-sm text-right tabular-nums">{org.contacts_count}</TableCell>
                  <TableCell className="text-[#A1A1AA] text-sm text-right tabular-nums">{org.calls_count}</TableCell>
                  <TableCell className="text-[#A1A1AA] text-sm text-right tabular-nums">{org.conversations_count}</TableCell>
                  <TableCell>
                    <ChevronRight className="h-4 w-4 text-[#71717A]" />
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
