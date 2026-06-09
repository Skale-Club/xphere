'use client'

import * as React from 'react'
import { format, isToday, isThisWeek, isPast, startOfDay } from 'date-fns'
import { Inbox, Circle, CalendarClock, FolderKanban } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { TaskDetailSheet } from '@/components/projects/task-detail-sheet'
import type { MyProjectTask } from '@/app/(dashboard)/projects/actions'
import type { ProjectTaskStep, TaskPriority, ProjectLabelRow } from '@/types/database'

// ─── Constants ────────────────────────────────────────────────────────────────

const PRIORITY_COLORS: Record<TaskPriority, string> = {
  low: 'bg-blue-400',
  medium: 'bg-yellow-400',
  high: 'bg-orange-400',
  urgent: 'bg-red-400',
}

const STEP_LABELS: Record<ProjectTaskStep, string> = {
  backlog: 'Backlog',
  todo: 'To Do',
  doing: 'Doing',
  done: 'Done',
}

const STEP_COLORS: Record<ProjectTaskStep, string> = {
  backlog: 'text-text-tertiary border-border-subtle',
  todo: 'text-blue-600 border-blue-200',
  doing: 'text-yellow-600 border-yellow-200',
  done: 'text-green-600 border-green-200',
}

const QUICK_FILTER_OPTIONS: { label: string; value: ProjectTaskStep | 'all' }[] = [
  { label: 'All', value: 'all' },
  { label: 'To Do', value: 'todo' },
  { label: 'Doing', value: 'doing' },
  { label: 'Done', value: 'done' },
]

// ─── Date helpers ─────────────────────────────────────────────────────────────

function getDateBucket(dateStr: string | null, completed: boolean): 'overdue' | 'today' | 'week' | 'later' | 'none' {
  if (!dateStr) return 'none'
  const date = new Date(dateStr + 'T00:00:00')
  const today = startOfDay(new Date())
  if (isToday(date)) return 'today'
  if (!completed && isPast(date) && !isToday(date)) return 'overdue'
  if (isThisWeek(date, { weekStartsOn: 1 }) && !isPast(startOfDay(date))) return 'week'
  return 'later'
}

function formatDueDate(dateStr: string | null): string | null {
  if (!dateStr) return null
  try {
    return format(new Date(dateStr + 'T00:00:00'), 'MMM d')
  } catch {
    return dateStr
  }
}

function isOverdue(dateStr: string | null, completed: boolean): boolean {
  if (!dateStr || completed) return false
  const date = startOfDay(new Date(dateStr + 'T00:00:00'))
  return isPast(date) && !isToday(date)
}

function isDueToday(dateStr: string | null, completed: boolean): boolean {
  if (!dateStr || completed) return false
  return isToday(new Date(dateStr + 'T00:00:00'))
}

// ─── Task Row ────────────────────────────────────────────────────────────────

interface TaskRowProps {
  task: MyProjectTask
  showProjectBadge: boolean
  onClick: (id: string) => void
}

function TaskRow({ task, showProjectBadge, onClick }: TaskRowProps) {
  const overdue = isOverdue(task.end_date, task.completed)
  const dueFormatted = formatDueDate(task.end_date)
  const stepLabel = STEP_LABELS[task.step]
  const stepColor = STEP_COLORS[task.step]
  const priorityColor = PRIORITY_COLORS[task.priority] ?? 'bg-gray-300'

  return (
    <button
      type="button"
      onClick={() => onClick(task.id)}
      className={cn(
        'group w-full flex items-center gap-3 px-3 py-2.5 rounded-md text-left',
        'hover:bg-bg-tertiary/60 transition-colors duration-100',
        task.completed && 'opacity-60',
      )}
    >
      {/* Priority dot */}
      <span
        className={cn('shrink-0 h-2 w-2 rounded-full', priorityColor)}
        aria-label={`Priority: ${task.priority}`}
      />

      {/* Task name */}
      <span
        className={cn(
          'flex-1 min-w-0 text-[13px] font-medium text-text-primary truncate',
          task.completed && 'line-through text-text-tertiary',
        )}
      >
        {task.name}
      </span>

      {/* Project badge (only in date grouping) */}
      {showProjectBadge && task.project_name && (
        <span className="shrink-0 flex items-center gap-1 max-w-[120px]">
          <span
            className="inline-block h-2 w-2 rounded-full shrink-0"
            style={{ backgroundColor: task.project_color ?? '#6366f1' }}
          />
          <span className="text-[11px] text-text-tertiary truncate">{task.project_name}</span>
        </span>
      )}

      {/* Step chip */}
      <span
        className={cn(
          'shrink-0 text-[11px] border rounded px-1.5 py-0.5 font-medium',
          stepColor,
        )}
      >
        {stepLabel}
      </span>

      {/* Due date */}
      {dueFormatted && (
        <span
          className={cn(
            'shrink-0 flex items-center gap-1 text-[11px] font-medium',
            overdue ? 'text-red-500' : 'text-text-tertiary',
          )}
        >
          <CalendarClock className="h-3 w-3 shrink-0" />
          {dueFormatted}
        </span>
      )}
    </button>
  )
}

// ─── Section Header ───────────────────────────────────────────────────────────

interface SectionHeaderProps {
  label: string
  count: number
  color?: string
  dot?: string | null
  variant?: 'overdue' | 'today' | 'normal'
}

function SectionHeader({ label, count, color, dot, variant = 'normal' }: SectionHeaderProps) {
  return (
    <div className="flex items-center gap-2 px-1 py-1.5 mb-0.5">
      {dot !== undefined ? (
        <span
          className="h-2.5 w-2.5 rounded-full shrink-0"
          style={{ backgroundColor: dot ?? '#6366f1' }}
        />
      ) : (
        <Circle
          className={cn(
            'h-3 w-3 shrink-0',
            variant === 'overdue' ? 'text-red-500' : variant === 'today' ? 'text-yellow-500' : 'text-text-tertiary',
          )}
        />
      )}
      <span
        className={cn(
          'text-[12px] font-semibold uppercase tracking-wide',
          variant === 'overdue' ? 'text-red-500' : variant === 'today' ? 'text-yellow-600' : 'text-text-tertiary',
        )}
        style={color ? { color } : undefined}
      >
        {label}
      </span>
      <Badge
        variant="secondary"
        className="h-4 min-w-4 px-1 text-[10px] font-semibold rounded-full"
      >
        {count}
      </Badge>
    </div>
  )
}

// ─── Grouped sections ─────────────────────────────────────────────────────────

interface GroupedByProjectProps {
  tasks: MyProjectTask[]
  onTaskClick: (id: string) => void
}

function GroupedByProject({ tasks, onTaskClick }: GroupedByProjectProps) {
  // Group tasks by project_id preserving insertion order
  const projectOrder: string[] = []
  const groups = new Map<string, { project_name: string; project_color: string | null; tasks: MyProjectTask[] }>()

  for (const task of tasks) {
    const key = task.project_id
    if (!groups.has(key)) {
      projectOrder.push(key)
      groups.set(key, {
        project_name: task.project_name,
        project_color: task.project_color,
        tasks: [],
      })
    }
    groups.get(key)!.tasks.push(task)
  }

  if (projectOrder.length === 0) return null

  return (
    <div className="space-y-4">
      {projectOrder.map((projectId) => {
        const group = groups.get(projectId)!
        return (
          <div key={projectId}>
            <SectionHeader
              label={group.project_name || 'Unnamed project'}
              count={group.tasks.length}
              dot={group.project_color}
            />
            <div className="pl-4 space-y-0.5">
              {group.tasks.map((task) => (
                <TaskRow
                  key={task.id}
                  task={task}
                  showProjectBadge={false}
                  onClick={onTaskClick}
                />
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

interface GroupedByDateProps {
  tasks: MyProjectTask[]
  onTaskClick: (id: string) => void
}

const DATE_BUCKETS: Array<{
  key: 'overdue' | 'today' | 'week' | 'later' | 'none'
  label: string
  variant: 'overdue' | 'today' | 'normal'
}> = [
  { key: 'overdue', label: 'Overdue', variant: 'overdue' },
  { key: 'today', label: 'Today', variant: 'today' },
  { key: 'week', label: 'This week', variant: 'normal' },
  { key: 'later', label: 'Later', variant: 'normal' },
  { key: 'none', label: 'No date', variant: 'normal' },
]

function GroupedByDate({ tasks, onTaskClick }: GroupedByDateProps) {
  const buckets = new Map<string, MyProjectTask[]>()
  for (const { key } of DATE_BUCKETS) buckets.set(key, [])

  for (const task of tasks) {
    const bucket = getDateBucket(task.end_date, task.completed)
    buckets.get(bucket)!.push(task)
  }

  const anyBucket = DATE_BUCKETS.some(({ key }) => (buckets.get(key)?.length ?? 0) > 0)
  if (!anyBucket) return null

  return (
    <div className="space-y-4">
      {DATE_BUCKETS.map(({ key, label, variant }) => {
        const group = buckets.get(key) ?? []
        if (group.length === 0) return null
        return (
          <div key={key}>
            <SectionHeader label={label} count={group.length} variant={variant} />
            <div className="pl-4 space-y-0.5">
              {group.map((task) => (
                <TaskRow
                  key={task.id}
                  task={task}
                  showProjectBadge
                  onClick={onTaskClick}
                />
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ─── Main Client Component ────────────────────────────────────────────────────

interface ProjectInboxClientProps {
  tasks: MyProjectTask[]
}

export function ProjectInboxClient({ tasks }: ProjectInboxClientProps) {
  const [grouping, setGrouping] = React.useState<'project' | 'date'>('project')
  const [quickFilter, setQuickFilter] = React.useState<ProjectTaskStep | 'all'>('all')
  const [openTaskId, setOpenTaskId] = React.useState<string | null>(null)

  // Derive summary stats from raw tasks (before step-filter)
  const today = React.useMemo(() => startOfDay(new Date()), [])
  const todayStr = today.toISOString().slice(0, 10)

  const overdueCount = React.useMemo(
    () => tasks.filter((t) => !t.completed && t.end_date != null && t.end_date < todayStr).length,
    [tasks, todayStr],
  )
  const dueTodayCount = React.useMemo(
    () => tasks.filter((t) => isDueToday(t.end_date, t.completed)).length,
    [tasks],
  )

  // Apply quick filter
  const filteredTasks = React.useMemo(
    () => (quickFilter === 'all' ? tasks : tasks.filter((t) => t.step === quickFilter)),
    [tasks, quickFilter],
  )

  // Task open handler
  const handleTaskClick = React.useCallback((id: string) => {
    setOpenTaskId(id)
  }, [])

  const handleSheetClose = React.useCallback(() => {
    setOpenTaskId(null)
  }, [])

  // The open task's project info (needed for TaskDetailSheet)
  const openTask = openTaskId != null ? tasks.find((t) => t.id === openTaskId) ?? null : null

  return (
    <div className="mx-auto w-full max-w-3xl px-4 sm:px-6 py-8">
      {/* Page title */}
      <div className="flex items-center gap-2.5 mb-1">
        <Inbox className="h-5 w-5 text-text-secondary shrink-0" />
        <h1 className="text-[18px] font-semibold text-text-primary">My Tasks</h1>
      </div>

      {/* Summary bar */}
      <p className="text-[13px] text-text-tertiary mb-6">
        {tasks.length} {tasks.length === 1 ? 'task' : 'tasks'}
        {overdueCount > 0 && (
          <span className="text-red-500 font-medium"> · {overdueCount} overdue</span>
        )}
        {dueTodayCount > 0 && (
          <span className="text-yellow-600 font-medium"> · {dueTodayCount} due today</span>
        )}
      </p>

      {/* Controls row */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        {/* Quick filter tabs */}
        <div className="flex items-center gap-1 bg-bg-tertiary/50 rounded-lg p-0.5">
          {QUICK_FILTER_OPTIONS.map(({ label, value }) => (
            <button
              key={value}
              type="button"
              onClick={() => setQuickFilter(value)}
              className={cn(
                'text-[12px] font-medium px-2.5 py-1 rounded-md transition-colors duration-100',
                quickFilter === value
                  ? 'bg-white shadow-sm text-text-primary dark:bg-bg-secondary'
                  : 'text-text-tertiary hover:text-text-secondary',
              )}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Group by toggle */}
        <div className="flex items-center gap-1 bg-bg-tertiary/50 rounded-lg p-0.5">
          <button
            type="button"
            onClick={() => setGrouping('project')}
            className={cn(
              'flex items-center gap-1.5 text-[12px] font-medium px-2.5 py-1 rounded-md transition-colors duration-100',
              grouping === 'project'
                ? 'bg-white shadow-sm text-text-primary dark:bg-bg-secondary'
                : 'text-text-tertiary hover:text-text-secondary',
            )}
          >
            <FolderKanban className="h-3 w-3" />
            By project
          </button>
          <button
            type="button"
            onClick={() => setGrouping('date')}
            className={cn(
              'flex items-center gap-1.5 text-[12px] font-medium px-2.5 py-1 rounded-md transition-colors duration-100',
              grouping === 'date'
                ? 'bg-white shadow-sm text-text-primary dark:bg-bg-secondary'
                : 'text-text-tertiary hover:text-text-secondary',
            )}
          >
            <CalendarClock className="h-3 w-3" />
            By due date
          </button>
        </div>
      </div>

      {/* Task list */}
      {filteredTasks.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <Inbox className="h-8 w-8 text-text-tertiary mb-3" />
          <p className="text-[14px] font-medium text-text-secondary">
            {tasks.length === 0 ? 'No tasks assigned to you' : 'No tasks match this filter'}
          </p>
          <p className="mt-1 text-[12px] text-text-tertiary">
            {tasks.length === 0
              ? 'Tasks assigned or responsible to you will appear here.'
              : 'Try selecting a different filter above.'}
          </p>
        </div>
      ) : grouping === 'project' ? (
        <GroupedByProject tasks={filteredTasks} onTaskClick={handleTaskClick} />
      ) : (
        <GroupedByDate tasks={filteredTasks} onTaskClick={handleTaskClick} />
      )}

      {/* Task detail sheet */}
      {openTaskId != null && openTask != null && (
        <TaskDetailSheet
          taskId={openTaskId}
          projectId={openTask.project_id}
          projectName={openTask.project_name}
          labels={[] as ProjectLabelRow[]}
          onClose={handleSheetClose}
          onRefresh={() => {
            // Server component will revalidate on next navigation;
            // for immediate UI feedback the sheet re-fetches internally.
          }}
        />
      )}
    </div>
  )
}
