'use client'

import { useMemo, useState, useTransition, type ReactNode } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  flexRender,
  type SortingState,
  type ColumnDef,
} from '@tanstack/react-table'
import { formatDistanceToNow } from 'date-fns'
import { MoreHorizontal, Pencil, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

import { cn } from '@/lib/utils'
import {
  AGENT_CHANNEL_LABELS,
  type AgentChannel,
} from '@/lib/agents/channels'
import {
  toggleAgentActive,
  softDeleteAgent,
  type AgentListItem,
} from '@/app/(dashboard)/agents/actions'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
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
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'

interface AgentsTableProps {
  agents: AgentListItem[]
  channelDefaults: Record<AgentChannel, string | null>
  children?: ReactNode
}

export function AgentsTable({
  agents,
  channelDefaults,
  children,
}: AgentsTableProps) {
  const router = useRouter()
  const [sorting, setSorting] = useState<SortingState>([])
  const [showInactive, setShowInactive] = useState(true)
  const [deleteTarget, setDeleteTarget] = useState<AgentListItem | null>(null)
  const [isPending, startTransition] = useTransition()

  const visibleAgents = useMemo(
    () => (showInactive ? agents : agents.filter((a) => a.is_active)),
    [agents, showInactive]
  )

  function handleToggleActive(agent: AgentListItem, nextActive: boolean) {
    startTransition(async () => {
      const result = await toggleAgentActive(agent.id, nextActive)
      if (result && 'error' in result && result.error) {
        toast.error(result.error)
      } else {
        toast.success(
          nextActive ? `Activated "${agent.name}".` : `Deactivated "${agent.name}".`
        )
        router.refresh()
      }
    })
  }

  function reassignmentCount(agentId: string): number {
    return Object.values(channelDefaults).filter((v) => v === agentId).length
  }

  function reassignmentChannels(agentId: string): AgentChannel[] {
    return (Object.entries(channelDefaults) as [AgentChannel, string | null][])
      .filter(([, v]) => v === agentId)
      .map(([ch]) => ch)
  }

  function handleDeleteConfirm() {
    if (!deleteTarget) return
    const target = deleteTarget
    setDeleteTarget(null)
    startTransition(async () => {
      const result = await softDeleteAgent(target.id)
      if (result && 'error' in result && result.error) {
        toast.error(result.error)
        return
      }
      const count = result?.reassignedCount ?? 0
      toast.success(
        count > 0
          ? `Deleted "${target.name}". ${count} channel default(s) reassigned to Main Agent.`
          : `Deleted "${target.name}".`
      )
      router.refresh()
    })
  }

  const columns: ColumnDef<AgentListItem>[] = [
    {
      accessorKey: 'name',
      header: () => <span className="text-xs font-medium">Name</span>,
      cell: ({ row }) => (
        <Link
          href={`/agents/${row.original.id}`}
          className="font-medium text-sm underline-offset-4 hover:underline"
        >
          {row.original.name}
        </Link>
      ),
    },
    {
      accessorKey: 'slug',
      header: () => <span className="text-xs font-medium">Slug</span>,
      cell: ({ row }) => (
        <span className="font-mono text-xs text-muted-foreground">
          {row.original.slug}
        </span>
      ),
    },
    {
      accessorKey: 'model',
      header: () => <span className="text-xs font-medium">Model</span>,
      cell: ({ row }) => (
        <Badge variant="outline" className="font-mono text-[10px]">
          {row.original.model}
        </Badge>
      ),
    },
    {
      accessorKey: 'tool_count',
      header: () => <span className="text-xs font-medium">Tools</span>,
      cell: ({ row }) => {
        const n = row.original.tool_count
        return (
          <Badge variant="secondary" className="text-[10px]">
            {n} attached
          </Badge>
        )
      },
    },
    {
      accessorKey: 'is_active',
      header: () => <span className="text-xs font-medium">Active</span>,
      cell: ({ row }) => (
        <Switch
          checked={row.original.is_active}
          disabled={isPending}
          onCheckedChange={(next) => handleToggleActive(row.original, next)}
          aria-label={`Toggle active for ${row.original.name}`}
        />
      ),
    },
    {
      accessorKey: 'updated_at',
      header: () => <span className="text-xs font-medium">Updated</span>,
      cell: ({ row }) => (
        <span className="text-xs text-muted-foreground">
          {formatDistanceToNow(new Date(row.original.updated_at), {
            addSuffix: true,
          })}
        </span>
      ),
    },
    {
      id: 'actions',
      header: () => null,
      cell: ({ row }) => {
        const agent = row.original
        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 w-8 p-0"
                aria-label="Row actions"
              >
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem asChild>
                <Link href={`/agents/${agent.id}`}>
                  <Pencil className="mr-2 h-3.5 w-3.5" />
                  Edit
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onClick={() => setDeleteTarget(agent)}
              >
                <Trash2 className="mr-2 h-3.5 w-3.5" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )
      },
    },
  ]

  const table = useReactTable({
    data: visibleAgents,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getRowId: (row) => row.id,
  })

  const pendingDeleteCount = deleteTarget ? reassignmentCount(deleteTarget.id) : 0
  const pendingDeleteChannels = deleteTarget
    ? reassignmentChannels(deleteTarget.id)
    : []

  return (
    <>
      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4">
        <div>{children}</div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <Switch
              id="show-inactive"
              checked={showInactive}
              onCheckedChange={setShowInactive}
            />
            <Label htmlFor="show-inactive" className="text-xs text-muted-foreground">
              Show inactive
            </Label>
          </div>
        </div>
      </div>

      <div className="overflow-hidden rounded-[12px] border border-border bg-bg-secondary shadow-elevation-sm">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <TableHead key={header.id}>
                    {header.isPlaceholder
                      ? null
                      : flexRender(
                          header.column.columnDef.header,
                          header.getContext()
                        )}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={columns.length}
                  className="h-16 text-center text-sm text-muted-foreground"
                >
                  No agents yet.
                </TableCell>
              </TableRow>
            ) : (
              table.getRowModel().rows.map((row) => (
                <TableRow
                  key={row.id}
                  className={cn(!row.original.is_active && 'opacity-60')}
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete agent?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDeleteCount > 0 ? (
                <>
                  &quot;{deleteTarget?.name}&quot; is currently the default agent
                  for {pendingDeleteCount} channel
                  {pendingDeleteCount === 1 ? '' : 's'}
                  {pendingDeleteChannels.length > 0 && (
                    <>
                      {' '}(
                      {pendingDeleteChannels
                        .map((ch) => AGENT_CHANNEL_LABELS[ch])
                        .join(', ')}
                      )
                    </>
                  )}
                  . {pendingDeleteCount} channel default
                  {pendingDeleteCount === 1 ? '' : 's'} will be reassigned to
                  Main Agent. Continue?
                </>
              ) : (
                <>
                  &quot;{deleteTarget?.name}&quot; will be deactivated. Historical
                  invocations stay queryable. Continue?
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteConfirm}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
