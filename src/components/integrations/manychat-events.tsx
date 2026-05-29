'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronLeft, ChevronRight } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
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
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { ManychatEventRow } from '@/app/(dashboard)/integrations/manychat/event-actions'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ManychatEventsProps = {
  initialEvents: ManychatEventRow[]
  initialTotal: number
  searchParams: { status?: string; from?: string; to?: string; offset?: string }
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const LIMIT = 25

// ---------------------------------------------------------------------------
// ManychatEvents
// ---------------------------------------------------------------------------

export function ManychatEvents({
  initialEvents,
  initialTotal,
  searchParams,
}: ManychatEventsProps) {
  const router = useRouter()

  const [selectedEvent, setSelectedEvent] = useState<ManychatEventRow | null>(null)
  const [statusFilter, setStatusFilter] = useState(searchParams.status ?? 'all')
  const [fromDate, setFromDate] = useState(searchParams.from ?? '')
  const [toDate, setToDate] = useState(searchParams.to ?? '')

  const currentOffset = parseInt(searchParams.offset ?? '0', 10) || 0
  const hasPrev = currentOffset > 0
  const hasNext = currentOffset + LIMIT < initialTotal

  // Build URL preserving current filters with a new offset
  function buildPageUrl(newOffset: number) {
    const params = new URLSearchParams()
    if (statusFilter && statusFilter !== 'all') params.set('status', statusFilter)
    if (fromDate) params.set('from', fromDate)
    if (toDate) params.set('to', toDate)
    params.set('offset', String(newOffset))
    return `/integrations/manychat/events?${params.toString()}`
  }

  function handleApplyFilters() {
    const params = new URLSearchParams()
    if (statusFilter && statusFilter !== 'all') params.set('status', statusFilter)
    if (fromDate) params.set('from', fromDate)
    if (toDate) params.set('to', toDate)
    router.push(`/integrations/manychat/events?${params.toString()}`)
  }

  function handleClearFilters() {
    setStatusFilter('all')
    setFromDate('')
    setToDate('')
    router.push('/integrations/manychat/events')
  }

  return (
    <div className="space-y-4">
      {/* Filter bar */}
      <div className="flex flex-wrap gap-4 items-end">
        {/* Status filter */}
        <div className="space-y-1">
          <Label className="text-xs">Status</Label>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-36 h-8 text-sm">
              <SelectValue placeholder="All statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="matched">Matched</SelectItem>
              <SelectItem value="unmatched">Unmatched</SelectItem>
              <SelectItem value="error">Error</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Date range */}
        <div className="space-y-1">
          <Label className="text-xs">From</Label>
          <Input
            type="date"
            className="h-8 text-sm w-36"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">To</Label>
          <Input
            type="date"
            className="h-8 text-sm w-36"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
          />
        </div>

        <Button size="sm" onClick={handleApplyFilters}>
          Apply
        </Button>
        <Button size="sm" variant="ghost" onClick={handleClearFilters}>
          Clear
        </Button>
      </div>

      {/* Events table */}
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Received at</TableHead>
              <TableHead>Event type</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Action log</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {initialEvents.length === 0 && (
              <TableRow>
                <TableCell colSpan={4} className="text-center text-muted-foreground py-8">
                  No events found.
                </TableCell>
              </TableRow>
            )}
            {initialEvents.map((event) => (
              <TableRow
                key={event.id}
                className="cursor-pointer hover:bg-muted/50"
                onClick={() => setSelectedEvent(event)}
              >
                <TableCell className="text-sm">
                  {new Date(event.created_at).toLocaleString()}
                </TableCell>
                <TableCell className="text-sm font-mono">{event.event_type}</TableCell>
                <TableCell>
                  <Badge
                    className={
                      event.status === 'matched'
                        ? 'bg-green-100 text-green-800 hover:bg-green-100'
                        : event.status === 'unmatched'
                          ? 'bg-amber-100 text-amber-800 hover:bg-amber-100'
                          : 'bg-red-100 text-red-800 hover:bg-red-100'
                    }
                  >
                    {event.status}
                  </Badge>
                </TableCell>
                <TableCell className="text-sm font-mono text-muted-foreground">
                  {event.action_log_id
                    ? event.action_log_id.slice(0, 8) + '…'
                    : '-'}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Pagination controls */}
      <div className="flex items-center justify-between pt-2">
        <p className="text-sm text-muted-foreground">
          {initialTotal === 0
            ? 'No events'
            : `Showing ${currentOffset + 1}–${Math.min(currentOffset + LIMIT, initialTotal)} of ${initialTotal}`}
        </p>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={!hasPrev}
            onClick={() => router.push(buildPageUrl(currentOffset - LIMIT))}
          >
            <ChevronLeft className="h-4 w-4 mr-1" />
            Previous
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={!hasNext}
            onClick={() => router.push(buildPageUrl(currentOffset + LIMIT))}
          >
            Next
            <ChevronRight className="h-4 w-4 ml-1" />
          </Button>
        </div>
      </div>

      {/* Payload Sheet */}
      <Sheet
        open={selectedEvent !== null}
        onOpenChange={(open) => {
          if (!open) setSelectedEvent(null)
        }}
      >
        <SheetContent className="sm:max-w-xl overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Event Payload</SheetTitle>
            <SheetDescription>
              {selectedEvent?.event_type}
              {selectedEvent
                ? ` · ${new Date(selectedEvent.created_at).toLocaleString()}`
                : ''}
            </SheetDescription>
          </SheetHeader>
          <div className="mt-4">
            <pre className="rounded-md bg-muted p-4 text-xs overflow-x-auto whitespace-pre-wrap break-all">
              {selectedEvent ? JSON.stringify(selectedEvent.event_payload, null, 2) : ''}
            </pre>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  )
}
