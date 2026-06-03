'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  flexRender,
  type SortingState,
  type ColumnDef,
} from '@tanstack/react-table'
import { format } from 'date-fns'
import { Building2, MoreHorizontal, ArrowUpDown } from 'lucide-react'
import { toast } from 'sonner'
import type { Database } from '@/types/database'
import { switchOrganization, toggleOrganizationStatus } from '@/app/(dashboard)/organizations/actions'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Dialog,
  DialogContent,
} from '@/components/ui/dialog'
import { OrganizationForm } from './organization-form'

type Organization = Database['public']['Tables']['organizations']['Row']

const statusConfig = {
  active: { label: 'Active', className: 'bg-emerald-500/15 text-emerald-400' },
  inactive: { label: 'Inactive', className: 'bg-yellow-500/15 text-yellow-400' },
  deactivated: { label: 'Deactivated', className: 'bg-zinc-500/15 text-zinc-400' },
} as const

interface OrganizationsTableProps {
  organizations: Organization[]
}

export function OrganizationsTable({ organizations: initialOrganizations }: OrganizationsTableProps) {
  const router = useRouter()
  const [organizations, setOrganizations] = useState<Organization[]>(initialOrganizations)
  const [sorting, setSorting] = useState<SortingState>([])
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [editingOrg, setEditingOrg] = useState<Organization | null>(null)
  const [isPending, startTransition] = useTransition()

  function openCreateDialog() {
    setEditingOrg(null)
    setIsDialogOpen(true)
  }

  function openEditDialog(org: Organization) {
    setEditingOrg(org)
    setIsDialogOpen(true)
  }

  function handleDialogSuccess() {
    setIsDialogOpen(false)
    setEditingOrg(null)
    router.refresh()
  }

  function handleToggleStatus(org: Organization) {
    const newStatus = !org.is_active
    // Optimistic update
    setOrganizations((prev) =>
      prev.map((o) => (o.id === org.id ? { ...o, is_active: newStatus } : o))
    )
    startTransition(async () => {
      const result = await toggleOrganizationStatus(org.id, newStatus)
      if (result && 'error' in result && result.error) {
        // Revert on error
        setOrganizations((prev) =>
          prev.map((o) => (o.id === org.id ? { ...o, is_active: org.is_active } : o))
        )
        toast.error('Failed to update organization. Try again.')
      }
    })
  }

  function handleSwitchOrganization(org: Organization) {
    if (!org.is_active || isPending) return
    startTransition(async () => {
      const result = await switchOrganization(org.id)
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success(`Switched to ${org.name}.`)
      router.push('/dashboard')
      router.refresh()
    })
  }

  const columns: ColumnDef<Organization>[] = [
    {
      accessorKey: 'name',
      header: ({ column }) => (
        <Button
          variant="ghost"
          size="sm"
          className="-ml-3 h-8"
          onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
        >
          Name
          <ArrowUpDown className="ml-2 h-4 w-4" />
        </Button>
      ),
      cell: ({ row }) => {
        const org = row.original
        const initial = (org.name ?? '?').trim().charAt(0).toUpperCase() || '?'
        return (
          <button
            type="button"
            onClick={() => handleSwitchOrganization(org)}
            disabled={!org.is_active || isPending}
            className="flex items-center gap-2.5 font-medium text-left text-text-primary transition-colors hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:cursor-not-allowed disabled:text-text-tertiary"
            title={org.is_active ? `Switch to ${org.name}` : 'Organization is inactive'}
          >
            <span className="flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-[6px] bg-bg-tertiary text-[11px] font-semibold text-text-secondary ring-1 ring-border-subtle">
              {org.logo_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={org.logo_url} alt="" className="h-full w-full object-cover" />
              ) : (
                initial
              )}
            </span>
            {org.name}
          </button>
        )
      },
    },
    {
      accessorKey: 'is_active',
      header: 'Status',
      cell: ({ row }) => {
        const isActive = row.getValue<boolean>('is_active')
        const config = isActive ? statusConfig.active : statusConfig.inactive
        return (
          <Badge variant="outline" className={config.className}>
            {config.label}
          </Badge>
        )
      },
    },
    {
      accessorKey: 'created_at',
      header: 'Created',
      cell: ({ row }) => {
        const dateStr = row.getValue<string>('created_at')
        return <span>{format(new Date(dateStr), 'MMM d, yyyy')}</span>
      },
    },
    {
      id: 'actions',
      header: () => null,
      cell: ({ row }) => {
        const org = row.original
        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="h-8 w-8 p-0" aria-label="Row actions">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => openEditDialog(org)}>
                Edit Organization
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleToggleStatus(org)}>
                {org.is_active ? 'Deactivate' : 'Reactivate'}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )
      },
    },
  ]

  const table = useReactTable({
    data: organizations,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  })

  if (isPending && organizations.length === 0) {
    return <OrganizationsTableSkeleton />
  }

  return (
    <>
      <div className="flex items-center justify-start mb-4">
        <span className="sr-only">Loading organizations...</span>
        <Button onClick={openCreateDialog}>Create Organization</Button>
      </div>

      {organizations.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 gap-4 text-center">
          <Building2 className="h-12 w-12 text-muted-foreground" />
          <div>
            <h2 className="text-xl font-semibold">No organizations yet</h2>
            <p className="text-sm text-muted-foreground mt-1">
              Create your first organization to start managing tenants.
            </p>
          </div>
          <Button onClick={openCreateDialog}>Create Organization</Button>
        </div>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              {table.getHeaderGroups().map((headerGroup) => (
                <TableRow key={headerGroup.id}>
                  {headerGroup.headers.map((header) => (
                    <TableHead key={header.id}>
                      {header.isPlaceholder
                        ? null
                        : flexRender(header.column.columnDef.header, header.getContext())}
                    </TableHead>
                  ))}
                </TableRow>
              ))}
            </TableHeader>
            <TableBody>
              {table.getRowModel().rows.length > 0 ? (
                table.getRowModel().rows.map((row) => (
                  <TableRow key={row.id}>
                    {row.getVisibleCells().map((cell) => (
                      <TableCell key={cell.id}>
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={columns.length} className="h-24 text-center">
                    No results.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="p-0 sm:max-w-lg">
          <OrganizationForm
            mode={editingOrg ? 'edit' : 'create'}
            organization={editingOrg ?? undefined}
            onSuccess={handleDialogSuccess}
          />
        </DialogContent>
      </Dialog>
    </>
  )
}

function OrganizationsTableSkeleton() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 h-12">
          <Skeleton className="h-4 w-[200px]" />
          <Skeleton className="h-4 w-[80px]" />
          <Skeleton className="h-4 w-[100px]" />
          <Skeleton className="h-4 w-[32px] ml-auto" />
        </div>
      ))}
    </div>
  )
}
