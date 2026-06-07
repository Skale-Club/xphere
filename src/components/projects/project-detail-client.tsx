'use client'

import * as React from 'react'
import { useRouter, usePathname } from 'next/navigation'
import Link from 'next/link'
import { CalendarDays, Check, GanttChartSquare, KanbanSquare, List, Pencil, Plus, Plug, X } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ProjectBoard } from './project-board'
import { ProjectList } from './project-list'
import { ProjectCalendar } from './project-calendar'
import { ProjectTimeline } from './project-timeline'
import { TaskDetailSheet } from './task-detail-sheet'
import { NewTaskDialog } from './new-task-dialog'
import { ProjectCrmContextPanel } from './project-crm-context'
import { ProjectFilterBar } from './project-filter-bar'
import {
  getProjectTasks,
  updateProject,
  upsertDefaultSavedView,
  createProjectSavedView,
  deleteProjectSavedView,
} from '@/app/(dashboard)/projects/actions'
import { applyProjectFilters } from '@/lib/projects/filter-utils'
import { useBreadcrumbOverride } from '@/components/layout/breadcrumb-override-context'
import type { ProjectCrmContext, TaskWithLabels } from '@/app/(dashboard)/projects/actions'
import type { ProjectFilterState } from '@/components/projects/project-filter-bar'
import type { ProjectRow, ProjectLabelRow, ProjectSavedViewRow } from '@/types/database'

type ViewTab = 'board' | 'list' | 'calendar' | 'timeline'

const TABS: { id: ViewTab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: 'board', label: 'Board', icon: KanbanSquare },
  { id: 'list', label: 'List', icon: List },
  { id: 'calendar', label: 'Calendar', icon: CalendarDays },
  { id: 'timeline', label: 'Timeline', icon: GanttChartSquare },
]

interface Props {
  project: ProjectRow
  effectiveColor: string
  initialTasks: TaskWithLabels[]
  labels: ProjectLabelRow[]
  crmContext: ProjectCrmContext
  defaultView: ViewTab
  initialSavedViews?: ProjectSavedViewRow[]
  defaultSavedView?: ProjectSavedViewRow | null
  assignees?: { id: string; full_name: string | null; avatar_url: string | null; email: string }[]
}

export function ProjectDetailClient({
  project,
  effectiveColor,
  initialTasks,
  labels,
  crmContext,
  defaultView,
  initialSavedViews = [],
  defaultSavedView = null,
  assignees = [],
}: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const { setSegmentLabel, setSegmentNode, setSuffix } = useBreadcrumbOverride()
  const [activeTab, setActiveTab] = React.useState<ViewTab>(defaultView)
  const [tasks, setTasks] = React.useState<TaskWithLabels[]>(initialTasks)
  const [openTaskId, setOpenTaskId] = React.useState<string | null>(null)
  const [savedViews, setSavedViews] = React.useState<ProjectSavedViewRow[]>(initialSavedViews)
  const [activeViewId, setActiveViewId] = React.useState<string | null>(defaultSavedView?.id ?? null)
  const [filterState, setFilterState] = React.useState<ProjectFilterState>(
    (defaultSavedView?.filters as ProjectFilterState | undefined) ?? {},
  )

  const filteredTasks = React.useMemo(
    () => applyProjectFilters(tasks, filterState),
    [tasks, filterState],
  )

  // ---------------------------------------------------------------------------
  // Filter bar handlers
  // ---------------------------------------------------------------------------

  async function handleViewSave(name: string, setAsDefault: boolean) {
    const result = await createProjectSavedView(
      project.id,
      name,
      filterState as Record<string, unknown>,
      {},
      activeTab,
      setAsDefault,
    )
    if ('error' in result) {
      toast.error(result.error)
      return
    }
    setSavedViews((prev) => [...prev, result.view])
    setActiveViewId(result.view.id)
    toast.success('View saved')
  }

  async function handleViewDelete(id: string) {
    const result = await deleteProjectSavedView(id)
    if (result.error) {
      toast.error(result.error)
      return
    }
    setSavedViews((prev) => prev.filter((v) => v.id !== id))
    if (activeViewId === id) setActiveViewId(null)
  }

  function handleViewSelect(view: ProjectSavedViewRow) {
    setFilterState((view.filters as ProjectFilterState | undefined) ?? {})
    setActiveViewId(view.id)
  }

  React.useEffect(() => {
    const segments = pathname.split('/').filter(Boolean)
    const projectSegment = segments[1]
    if (projectSegment) {
      setSegmentLabel(projectSegment, project.name)
      setSegmentNode(
        projectSegment,
        <ProjectBreadcrumbName
          key={`${project.id}:${project.name}`}
          projectId={project.id}
          name={project.name}
        />,
      )
    }
    return () => {
      if (projectSegment) setSegmentNode(projectSegment, null)
    }
  }, [pathname, project.id, project.name, setSegmentLabel, setSegmentNode])

  React.useEffect(() => {
    setSuffix(
      <span
        className="h-2.5 w-2.5 rounded-full inline-block ml-1.5"
        style={{ backgroundColor: effectiveColor }}
      />
    )
    return () => setSuffix(null)
  }, [effectiveColor, setSuffix])

  function switchTab(tab: ViewTab) {
    setActiveTab(tab)
    router.replace(`/projects/${project.id}?view=${tab}`, { scroll: false })
    upsertDefaultSavedView(project.id, tab)
  }

  async function refresh() {
    const updated = await getProjectTasks(project.id)
    setTasks(updated)
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 px-4 sm:px-6 lg:px-8 pt-6 pb-3">
        <div className="flex items-center gap-4 min-w-0">
          <NewTaskDialog projectId={project.id} onCreated={refresh}>
            <Button size="sm" className="shrink-0">
              <Plus className="h-4 w-4 mr-1.5" />
              Task
            </Button>
          </NewTaskDialog>

          <div className="flex items-center gap-0.5 rounded-lg bg-muted/60 p-0.5 border border-border/40">
            {TABS.map((tab) => {
              const Icon = tab.icon
              return (
                <button
                  key={tab.id}
                  onClick={() => switchTab(tab.id)}
                  className={cn(
                    'flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md transition-all whitespace-nowrap',
                    activeTab === tab.id
                      ? 'bg-background text-foreground shadow-sm font-medium'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  <Icon className="h-3.5 w-3.5 shrink-0" />
                  {tab.label}
                </button>
              )
            })}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Link href="/settings/mcp">
            <Button size="sm" variant="ghost" className="h-8 px-2 text-muted-foreground" title="MCP Settings">
              <Plug className="h-4 w-4" />
            </Button>
          </Link>
        </div>
      </div>

      {/* Filter bar */}
      <div className="px-4 sm:px-6 lg:px-8 border-b border-border-subtle">
        <ProjectFilterBar
          filters={filterState}
          onFiltersChange={(f) => { setFilterState(f); setActiveViewId(null) }}
          savedViews={savedViews}
          activeViewId={activeViewId}
          onViewSelect={handleViewSelect}
          onViewSave={handleViewSave}
          onViewDelete={handleViewDelete}
          assignees={assignees}
          labels={labels.map((l) => ({ id: l.id, name: l.name, color: l.color ?? '#6366f1' }))}
        />
      </div>

      {/* Board + Calendar — direct flex children so flex-1 inside them works */}
      <ProjectCrmContextPanel context={crmContext} />

      {activeTab === 'board' && (
        <ProjectBoard
          projectId={project.id}
          tasks={filteredTasks}
          onOpenTask={setOpenTaskId}
          onRefresh={refresh}
        />
      )}
      {activeTab === 'calendar' && (
        <ProjectCalendar
          projectId={project.id}
          tasks={filteredTasks}
          onOpenTask={setOpenTaskId}
          onRefresh={refresh}
        />
      )}

      {/* Timeline — direct flex child for full-height Gantt */}
      {activeTab === 'timeline' && (
        <ProjectTimeline
          projectId={project.id}
          tasks={filteredTasks}
          onOpenTask={setOpenTaskId}
          onRefresh={refresh}
        />
      )}

      {/* List — wrapped with scroll + padding */}
      {activeTab === 'list' && (
        <div className="flex-1 min-h-0 overflow-auto px-4 sm:px-6 lg:px-8 py-4">
          <ProjectList
            projectId={project.id}
            tasks={filteredTasks}
            onOpenTask={setOpenTaskId}
            onRefresh={refresh}
          />
        </div>
      )}

      {/* Task detail sheet */}
      <TaskDetailSheet
        taskId={openTaskId}
        projectId={project.id}
        projectName={project.name}
        labels={labels}
        onClose={() => setOpenTaskId(null)}
        onRefresh={refresh}
      />
    </div>
  )
}

function ProjectBreadcrumbName({ projectId, name }: { projectId: string; name: string }) {
  const router = useRouter()
  const [editing, setEditing] = React.useState(false)
  const [draft, setDraft] = React.useState(name)
  const [displayName, setDisplayName] = React.useState(name)
  const [saving, setSaving] = React.useState(false)

  function beginRename() {
    setDraft(displayName)
    setEditing(true)
  }

  async function commitRename() {
    const nextName = draft.trim()
    if (!nextName) {
      toast.error('Project name is required.')
      return
    }
    if (nextName === displayName) {
      setEditing(false)
      return
    }
    setSaving(true)
    try {
      await updateProject(projectId, { name: nextName })
      setDisplayName(nextName)
      setEditing(false)
      toast.success('Project renamed')
      router.refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to rename project')
    } finally {
      setSaving(false)
    }
  }

  if (editing) {
    return (
      <span className="inline-flex min-w-0 items-center gap-1">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitRename()
            if (e.key === 'Escape') setEditing(false)
          }}
          autoFocus
          disabled={saving}
          maxLength={120}
          className="h-7 w-44 px-2 py-0 text-sm sm:w-56"
        />
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="h-6 w-6 shrink-0 text-emerald-500"
          onClick={commitRename}
          disabled={saving}
          aria-label="Save project name"
        >
          <Check className="h-3.5 w-3.5" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="h-6 w-6 shrink-0 text-text-tertiary"
          onClick={() => setEditing(false)}
          disabled={saving}
          aria-label="Cancel rename"
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </span>
    )
  }

  return (
    <button
      type="button"
      onClick={beginRename}
      className="group/project-breadcrumb inline-flex min-w-0 items-center gap-1 rounded-[6px] px-1 py-0.5 text-left text-inherit hover:bg-bg-tertiary/70"
      aria-label="Rename project"
      title="Rename project"
    >
      <span className="truncate">{displayName}</span>
      <Pencil className="h-3 w-3 shrink-0 opacity-0 transition-opacity group-hover/project-breadcrumb:opacity-70" />
    </button>
  )
}
