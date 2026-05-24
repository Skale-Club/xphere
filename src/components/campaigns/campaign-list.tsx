'use client'

import * as React from 'react'
import Link from 'next/link'
import { format } from 'date-fns'
import { Phone, Trash2, Plus, MoreHorizontal } from 'lucide-react'
import { useState, useMemo } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  FilterPopover,
  FilterPopoverHeader,
  FilterSection,
  FilterPill,
} from '@/components/data-table/filter-popover'
import { deleteCampaign } from '@/app/(dashboard)/outbound/actions'
import type { CampaignListItem } from '@/app/(dashboard)/outbound/actions'
import type { CampaignStatus } from '@/types/database'
import { cn } from '@/lib/utils'
import { useBreadcrumbOverride } from '@/components/layout/breadcrumb-override-context'

interface CampaignStatusBadgeProps {
  status: CampaignStatus
}

function CampaignStatusBadge({ status }: CampaignStatusBadgeProps) {
  const styles: Record<CampaignStatus, string> = {
    in_progress: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
    paused:      'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
    stopped:     'bg-red-500/10 text-red-400 border-red-500/20',
    completed:   'bg-zinc-500/10 text-zinc-400 border-zinc-500/20',
    draft:       'bg-slate-500/10 text-slate-400 border-slate-500/20',
    scheduled:   'bg-blue-500/10 text-blue-400 border-blue-500/20',
  }
  return (
    <Badge variant="outline" className={cn('text-[10.5px] font-medium', styles[status])}>
      {status.replace('_', ' ')}
    </Badge>
  )
}

const STATUS_OPTIONS: { value: CampaignStatus; label: string }[] = [
  { value: 'draft', label: 'Draft' },
  { value: 'scheduled', label: 'Scheduled' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'paused', label: 'Paused' },
  { value: 'stopped', label: 'Stopped' },
  { value: 'completed', label: 'Completed' },
]

interface CampaignListProps {
  campaigns: CampaignListItem[]
}

export function CampaignList({ campaigns }: CampaignListProps) {
  const [deleting, setDeleting] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<CampaignStatus | 'all'>('all')
  const { setSuffix } = useBreadcrumbOverride()

  React.useEffect(() => {
    setSuffix(<Badge variant="secondary">{campaigns.length}</Badge>)
    return () => setSuffix(null)
  }, [campaigns.length, setSuffix])

  const filtered = useMemo(() => {
    if (statusFilter === 'all') return campaigns
    return campaigns.filter((c) => c.status === statusFilter)
  }, [campaigns, statusFilter])

  const activeCount = statusFilter === 'all' ? 0 : 1

  async function handleDelete(campaignId: string) {
    if (!window.confirm('Delete this campaign? This action cannot be undone.')) return
    setDeleting(campaignId)
    try {
      await deleteCampaign(campaignId)
    } finally {
      setDeleting(null)
    }
  }

  return (
    <div className="flex flex-col">
      {/* Toolbar */}
      <div className="-mt-6 flex items-center gap-2 pb-4">
        <Button asChild size="sm" className="h-8">
          <Link href="/outbound/new">
            <Plus className="h-3.5 w-3.5 mr-1.5" />
            <span className="sm:hidden">Campaign</span>
            <span className="hidden sm:inline">New Campaign</span>
          </Link>
        </Button>

        <div className="hidden sm:block flex-1" />

        {/* Desktop filter */}
        <div className="hidden sm:block">
          <FilterPopover activeCount={activeCount}>
            <FilterPopoverHeader
              title="Filters"
              showClear={activeCount > 0}
              onClear={() => setStatusFilter('all')}
            />
            <div className="p-4 space-y-5">
              <FilterSection title="Status">
                {STATUS_OPTIONS.map((opt) => (
                  <FilterPill
                    key={opt.value}
                    active={statusFilter === opt.value}
                    onClick={() =>
                      setStatusFilter((prev) =>
                        prev === opt.value ? 'all' : opt.value
                      )
                    }
                  >
                    {opt.label}
                  </FilterPill>
                ))}
              </FilterSection>
            </div>
          </FilterPopover>
        </div>

        {/* Mobile filter */}
        <div className="sm:hidden">
          <FilterPopover activeCount={activeCount}>
            <FilterPopoverHeader
              title="Filters"
              showClear={activeCount > 0}
              onClear={() => setStatusFilter('all')}
            />
            <div className="p-4 space-y-5">
              <FilterSection title="Status">
                {STATUS_OPTIONS.map((opt) => (
                  <FilterPill
                    key={opt.value}
                    active={statusFilter === opt.value}
                    onClick={() =>
                      setStatusFilter((prev) =>
                        prev === opt.value ? 'all' : opt.value
                      )
                    }
                  >
                    {opt.label}
                  </FilterPill>
                ))}
              </FilterSection>
            </div>
          </FilterPopover>
        </div>
      </div>

      <div className="pb-8">
        {filtered.length === 0 ? (
          <div className="flex min-h-[240px] flex-col items-center justify-center rounded-[8px] border border-dashed border-border bg-bg-secondary/30 px-4 py-16 text-center">
            <Phone className="h-10 w-10 text-muted-foreground mb-4" />
            <h3 className="text-base font-semibold mb-1">
              {statusFilter !== 'all' ? 'No campaigns match the filter' : 'No campaigns yet'}
            </h3>
            <p className="text-sm text-muted-foreground mb-4">
              {statusFilter !== 'all'
                ? 'Try a different filter or clear it to see all campaigns.'
                : 'Create your first outbound calling campaign'}
            </p>
            {statusFilter !== 'all' ? (
              <Button size="sm" variant="outline" onClick={() => setStatusFilter('all')}>
                Clear Filter
              </Button>
            ) : (
              <Button asChild size="sm" variant="outline">
                <Link href="/outbound/new">New Campaign</Link>
              </Button>
            )}
          </div>
        ) : (
          <div className="rounded-[12px] border border-border bg-bg-secondary overflow-hidden">
            {/* Header */}
            <div
              className="grid items-center gap-3 px-4 py-2.5 border-b border-border-subtle bg-bg-secondary text-[11px] font-medium uppercase tracking-wide text-text-tertiary"
              style={{ gridTemplateColumns: '2fr 120px 80px 100px 80px 140px 100px 48px' }}
            >
              <div>Name</div>
              <div>Status</div>
              <div className="text-right">Total</div>
              <div className="text-right">Completed</div>
              <div className="text-right">Failed</div>
              <div>Schedule</div>
              <div>Created</div>
              <div />
            </div>

            {/* Rows */}
            <div className="divide-y divide-border-subtle">
              {filtered.map((c) => (
                <div
                  key={c.id}
                  className={cn(
                    'grid items-center gap-3 px-4 py-3',
                    'transition-all duration-200 ease-out hover:bg-bg-tertiary/40'
                  )}
                  style={{ gridTemplateColumns: '2fr 120px 80px 100px 80px 140px 100px 48px' }}
                >
                  {/* Name */}
                  <div className="min-w-0">
                    <Link
                      href={`/outbound/${c.id}`}
                      className="truncate text-[13px] font-medium text-text-primary hover:underline"
                    >
                      {c.name}
                    </Link>
                  </div>

                  {/* Status */}
                  <div>
                    <CampaignStatusBadge status={c.status as CampaignStatus} />
                  </div>

                  {/* Total */}
                  <div className="text-right text-[12.5px] text-text-secondary tabular-nums">
                    {c.total_contacts}
                  </div>

                  {/* Completed */}
                  <div className="text-right text-[12.5px] text-emerald-400 tabular-nums">
                    {c.completed_contacts}
                  </div>

                  {/* Failed */}
                  <div className="text-right text-[12.5px] text-red-400 tabular-nums">
                    {c.failed_contacts}
                  </div>

                  {/* Schedule */}
                  <div className="text-[11.5px] text-text-tertiary">
                    {c.scheduled_start_at
                      ? format(new Date(c.scheduled_start_at), 'MMM d, HH:mm')
                      : '|'}
                  </div>

                  {/* Created */}
                  <div className="text-[11.5px] text-text-tertiary">
                    {format(new Date(c.created_at), 'MMM d, yyyy')}
                  </div>

                  {/* Actions */}
                  <div className="flex justify-end">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Row actions">
                          <MoreHorizontal className="h-4 w-4 text-text-tertiary" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem asChild>
                          <Link href={`/outbound/${c.id}`}>View</Link>
                        </DropdownMenuItem>
                        {['draft', 'completed', 'stopped'].includes(c.status) && (
                          <DropdownMenuItem
                            className="text-destructive"
                            onClick={() => handleDelete(c.id)}
                          >
                            <Trash2 className="h-3.5 w-3.5 mr-2" /> Delete
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
