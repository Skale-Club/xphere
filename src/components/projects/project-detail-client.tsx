'use client'

import * as React from 'react'
import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import Link from 'next/link'
import { KanbanSquare, List, CalendarDays, GanttChartSquare, Plus, Plug } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { ProjectBoard } from './project-board'
import { ProjectList } from './project-list'
import { ProjectCalendar } from './project-calendar'
import { ProjectTimeline } from './project-timeline'
import { TaskDetailSheet } from './task-detail-sheet'
import { NewTaskDialog } from './new-task-dialog'
import { getProjectTasks, upsertDefaultSavedView } from '@/app/(dashboard)/projects/actions'
import { useBreadcrumbOverride } from '@/components/layout/breadcrumb-override-context'
import type { TaskWithLabels } from '@/app/(dashboard)/projects/actions'
import type { ProjectRow, ProjectLabelRow } from '@/types/database'

type ViewTab = 'board' | 'list' | 'calendar' | 'timeline'

const TABS: { id: ViewTab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: 'board', label: 'Board', icon: KanbanSquare },
  { id: 'list', label: 'List', icon: List },
  { id: 'calendar', label: 'Calendar', icon: CalendarDays },
  { id: 'timeline', label: 'Timeline', icon: GanttChartSquare },
]

interface Props {
  project: ProjectRow
  initialTasks: TaskWithLabels[]
  labels: ProjectLabelRow[]
  defaultView: ViewTab
}

export function ProjectDetailClient({ project, initialTasks, labels, defaultView }: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const { setSegmentLabel, setSuffix } = useBreadcrumbOverride()
  const [activeTab, setActiveTab] = React.useState<ViewTab>(defaultView)
  const [tasks, setTasks] = React.useState<TaskWithLabels[]>(initialTasks)
  const [openTaskId, setOpenTaskId] = React.useState<string | null>(null)

  React.useEffect(() => {
    const segments = pathname.split('/').filter(Boolean)
    const projectSegment = segments[1]
    if (projectSegment) {
      setSegmentLabel(projectSegment, project.name)
    }
  }, [pathname, project.name, setSegmentLabel])

  React.useEffect(() => {
    setSuffix(
      <span
        className="h-2.5 w-2.5 rounded-full inline-block ml-1.5"
        style={{ backgroundColor: project.color ?? '#6366f1' }}
      />
    )
    return () => setSuffix(null)
  }, [project.color, project.name, setSuffix])

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

      {/* Board + Calendar — direct flex children so flex-1 inside them works */}
      {activeTab === 'board' && (
        <ProjectBoard
          projectId={project.id}
          tasks={tasks}
          onOpenTask={setOpenTaskId}
          onRefresh={refresh}
        />
      )}
      {activeTab === 'calendar' && (
        <ProjectCalendar
          projectId={project.id}
          tasks={tasks}
          onOpenTask={setOpenTaskId}
          onRefresh={refresh}
        />
      )}

      {/* Timeline — direct flex child for full-height Gantt */}
      {activeTab === 'timeline' && (
        <ProjectTimeline
          projectId={project.id}
          tasks={tasks}
          onOpenTask={setOpenTaskId}
          onRefresh={refresh}
        />
      )}

      {/* List — wrapped with scroll + padding */}
      {activeTab === 'list' && (
        <div className="flex-1 min-h-0 overflow-auto px-4 sm:px-6 lg:px-8 py-4">
          <ProjectList
            projectId={project.id}
            tasks={tasks}
            onOpenTask={setOpenTaskId}
            onRefresh={refresh}
          />
        </div>
      )}

      {/* Task detail sheet */}
      <TaskDetailSheet
        taskId={openTaskId}
        projectId={project.id}
        labels={labels}
        onClose={() => setOpenTaskId(null)}
        onRefresh={refresh}
      />
    </div>
  )
}
