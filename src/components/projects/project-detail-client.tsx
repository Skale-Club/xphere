'use client'

import * as React from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
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
  const [activeTab, setActiveTab] = React.useState<ViewTab>(defaultView)
  const [tasks, setTasks] = React.useState<TaskWithLabels[]>(initialTasks)
  const [openTaskId, setOpenTaskId] = React.useState<string | null>(null)

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
    <div className="flex flex-col flex-1 min-h-0">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 px-4 sm:px-6 lg:px-8 pt-2 pb-3">
        <div className="flex items-center gap-3 min-w-0">
          <div
            className="h-3.5 w-3.5 rounded-full shrink-0"
            style={{ backgroundColor: project.color ?? '#6366f1' }}
          />
          <div className="flex flex-col min-w-0">
            <h1 className="text-xl font-semibold leading-tight truncate">{project.name}</h1>
            {project.description && (
              <p className="text-sm text-muted-foreground truncate max-w-md">{project.description}</p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Link href="/settings/mcp">
            <Button size="sm" variant="ghost" className="h-8 px-2 text-muted-foreground" title="MCP Settings">
              <Plug className="h-4 w-4" />
            </Button>
          </Link>
          <NewTaskDialog projectId={project.id} onCreated={refresh}>
            <Button size="sm">
              <Plus className="h-4 w-4 mr-1.5" />
              Add Task
            </Button>
          </NewTaskDialog>
        </div>
      </div>

      {/* Tabs */}
      <div className="sticky top-0 z-10 bg-background overflow-x-auto scrollbar-none border-b border-border-subtle">
        <div className="flex items-center gap-1 px-4 sm:px-6 lg:px-8 pb-0">
          {TABS.map((tab) => {
            const Icon = tab.icon
            return (
              <button
                key={tab.id}
                onClick={() => switchTab(tab.id)}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-2.5 min-h-[44px] text-sm border-b-2 transition-all duration-150 -mb-px whitespace-nowrap',
                  activeTab === tab.id
                    ? 'border-foreground text-foreground font-medium'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                )}
              >
                <Icon className="h-4 w-4" />
                {tab.label}
              </button>
            )
          })}
        </div>
      </div>

      {/* View content */}
      <div className={cn(
        'flex-1 min-h-0 px-4 sm:px-6 lg:px-8 py-4',
        activeTab === 'board' ? 'overflow-hidden' : 'overflow-auto'
      )}>
        {activeTab === 'board' && (
          <ProjectBoard
            projectId={project.id}
            tasks={tasks}
            onOpenTask={setOpenTaskId}
            onRefresh={refresh}
          />
        )}
        {activeTab === 'list' && (
          <ProjectList
            projectId={project.id}
            tasks={tasks}
            onOpenTask={setOpenTaskId}
            onRefresh={refresh}
          />
        )}
        {activeTab === 'calendar' && (
          <ProjectCalendar
            tasks={tasks}
            onOpenTask={setOpenTaskId}
          />
        )}
        {activeTab === 'timeline' && (
          <ProjectTimeline
            projectId={project.id}
            tasks={tasks}
            onOpenTask={setOpenTaskId}
            onRefresh={refresh}
          />
        )}
      </div>

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
