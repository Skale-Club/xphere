import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft, User, Calendar, Tag, Phone, Mail, Building2 } from 'lucide-react'

import {
  getOpportunity,
  getActivities,
  getStages,
} from '../actions'
import { OpportunityDetailClient } from '@/components/pipeline/opportunity-detail-client'
import { OppTagsWidget } from '@/components/pipeline/opp-tags-widget'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { formatCurrency, initialsOf, relativeTime } from '@/lib/pipeline/format'
import { getOpportunityTagIds, listTags } from '@/app/(dashboard)/settings/tags/actions'
import { TasksPanel } from '@/components/tasks/tasks-panel'
import { NotesPanel } from '@/components/notes/notes-panel'

interface Props {
  params: Promise<{ opportunityId: string }>
}

export default async function OpportunityDetailPage({ params }: Props) {
  const { opportunityId } = await params
  const [opp, activities, opportunityTagIds, allTags] = await Promise.all([
    getOpportunity(opportunityId),
    getActivities(opportunityId),
    getOpportunityTagIds(opportunityId),
    listTags(),
  ])
  if (!opp) notFound()

  const stages = await getStages(opp.pipeline_id)

  return (
    <div className="mx-auto w-full max-w-none px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      <div className="animate-fade-in flex items-center justify-between gap-3">
        <Button asChild variant="ghost" size="sm">
          <Link href={`/pipeline?pipeline=${opp.pipeline_id}`}>
            <ArrowLeft className="h-3.5 w-3.5" /> Back to pipeline
          </Link>
        </Button>
      </div>

      {/* Hero */}
      <div className="rounded-[12px] border border-border bg-bg-secondary p-6">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 text-[12px] uppercase tracking-[0.08em] text-text-tertiary">
              <Tag className="h-3.5 w-3.5" />
              <span
                className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium"
                style={{
                  backgroundColor: `${opp.stage?.color ?? '#6366F1'}1f`,
                  color: opp.stage?.color ?? '#6366F1',
                }}
              >
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: opp.stage?.color ?? '#6366F1' }} />
                {opp.stage?.name ?? 'Stage'}
              </span>
              <span className="ml-1 capitalize text-text-tertiary">· {opp.status}</span>
            </div>
            <h1 className="mt-2 text-[26px] font-semibold tracking-tight text-text-primary">{opp.title}</h1>
            <div className="mt-1 text-[24px] font-semibold tabular-nums text-accent">
              {formatCurrency(Number(opp.value), opp.currency)}
            </div>
          </div>

          {opp.contact && (
            <Link
              href={`/contacts?id=${opp.contact.id}`}
              className="flex items-center gap-3 rounded-[10px] border border-border-subtle bg-bg-primary px-3 py-2.5 hover:border-border-strong transition-colors min-w-[220px]"
            >
              <Avatar className="h-10 w-10">
                <AvatarFallback className="text-[12px] font-semibold bg-accent-muted text-accent">
                  {initialsOf(opp.contact.name)}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-medium text-text-primary truncate">
                  {opp.contact.name ?? 'Unnamed'}
                </div>
                <div className="text-[11.5px] text-text-tertiary truncate">
                  {opp.contact.phone ?? opp.contact.email ?? ''}
                </div>
              </div>
            </Link>
          )}
        </div>
      </div>

      {/* Two columns */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-4">
        {/* Main content: activity + tasks + notes */}
        <Tabs defaultValue="activity" className="space-y-4">
          <TabsList>
            <TabsTrigger value="activity">Activity</TabsTrigger>
            <TabsTrigger value="tasks">Tasks</TabsTrigger>
            <TabsTrigger value="notes">Notes</TabsTrigger>
          </TabsList>
          <TabsContent value="activity">
            <OpportunityDetailClient
              opportunityId={opp.id}
              stages={stages}
              currentStageId={opp.stage_id}
              activities={activities}
            />
          </TabsContent>
          <TabsContent value="tasks">
            <TasksPanel entityType="opportunity" entityId={opp.id} />
          </TabsContent>
          <TabsContent value="notes">
            <NotesPanel entityType="opportunity" entityId={opp.id} />
          </TabsContent>
        </Tabs>

        {/* Metadata sidebar */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-[13px]">Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <SidebarItem
              icon={User}
              label="Assigned to"
              value={opp.assigned_to ? opp.assigned_to.slice(0, 8) + '…' : 'Unassigned'}
            />
            <SidebarItem
              icon={Calendar}
              label="Expected close"
              value={opp.expected_close_date ?? 'Not set'}
            />
            <SidebarItem
              icon={Calendar}
              label="Created"
              value={relativeTime(opp.created_at)}
            />
            <SidebarItem
              icon={Calendar}
              label="Last updated"
              value={relativeTime(opp.updated_at)}
            />
            <div className="border-t border-border-subtle pt-3 -mx-2 px-2">
              <OppTagsWidget
                opportunityId={opp.id}
                initialTagIds={opportunityTagIds}
                allTags={allTags}
              />
            </div>
            {opp.contact && (
              <>
                <div className="border-t border-border-subtle pt-3 -mx-2 px-2 text-[11px] uppercase tracking-wide text-text-tertiary">
                  Contact
                </div>
                <SidebarItem icon={Phone} label="Phone" value={opp.contact.phone ?? 'Not set'} />
                <SidebarItem icon={Mail} label="Email" value={opp.contact.email ?? 'Not set'} />
                <SidebarItem icon={Building2} label="Company" value={opp.contact.company ?? 'Not set'} />
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function SidebarItem({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: string
}) {
  return (
    <div className="flex items-start gap-2.5">
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] bg-bg-tertiary ring-1 ring-border-subtle text-text-tertiary">
        <Icon className="h-3.5 w-3.5" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[10.5px] uppercase tracking-wide text-text-tertiary">{label}</div>
        <div className="text-[12.5px] text-text-primary truncate">{value}</div>
      </div>
    </div>
  )
}
