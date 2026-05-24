'use client'

import { useState, useTransition, useMemo, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import {
  addWeeks,
  endOfWeek,
  format,
  isSameDay,
  isWithinInterval,
  parseISO,
  startOfDay,
  startOfWeek,
} from 'date-fns'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'

import { MiniCalendar } from './mini-calendar'
import { TaskGroup } from './task-group'
import {
  EMPTY_TASK_QUICK_FILTERS,
  TasksFilterBar,
  type TaskQuickFilters,
  type TaskSortKey,
} from './tasks-filter-bar'
import { TaskSlideOver } from './task-slide-over'
import { groupTasks } from './task-groups-utils'
import { toggleTaskDone, deleteTask } from '@/app/(dashboard)/tasks/actions'
import type { TaskRow, ContactOption } from '@/app/(dashboard)/tasks/actions'
import { useBreadcrumbOverride } from '@/components/layout/breadcrumb-override-context'
import { cn } from '@/lib/utils'

interface TasksViewProps {
  tasks: TaskRow[]
  contacts: ContactOption[]
}

const SAVED_TASKS_VIEW_KEY = 'xphere.tasks.saved-view'

interface SavedTasksView {
  statusFilter: string
  quickFilters: TaskQuickFilters
  sortBy: TaskSortKey
}

type CalendarFilterKey = 'all' | 'overdue' | 'today' | 'this_week' | 'next_week' | 'no_date'

const CALENDAR_FILTERS: Array<{ value: CalendarFilterKey; label: string }> = [
  { value: 'all', label: 'All dates' },
  { value: 'overdue', label: 'Overdue' },
  { value: 'today', label: 'Today' },
  { value: 'this_week', label: 'This week' },
  { value: 'next_week', label: 'Next week' },
  { value: 'no_date', label: 'No date' },
]

function timestamp(value: string | null | undefined) {
  return value ? parseISO(value).getTime() : null
}

function compareNullableNumbers(
  a: number | null,
  b: number | null,
  direction: 'asc' | 'desc',
) {
  if (a === null && b === null) return 0
  if (a === null) return 1
  if (b === null) return -1
  return direction === 'asc' ? a - b : b - a
}

function compareNullableStrings(a: string | null, b: string | null) {
  if (!a && !b) return 0
  if (!a) return 1
  if (!b) return -1
  return a.localeCompare(b)
}

function sortTasks(tasks: TaskRow[], sortBy: TaskSortKey) {
  return [...tasks].sort((a, b) => {
    switch (sortBy) {
      case 'assignee':
        return compareNullableStrings(a.assigned_to, b.assigned_to)
      case 'created_at':
        return compareNullableNumbers(timestamp(a.created_at), timestamp(b.created_at), 'desc')
      case 'updated_at':
        return compareNullableNumbers(timestamp(a.updated_at), timestamp(b.updated_at), 'desc')
      case 'completed_on':
        return compareNullableNumbers(
          a.status === 'done' ? timestamp(a.updated_at) : null,
          b.status === 'done' ? timestamp(b.updated_at) : null,
          'desc',
        )
      case 'due_date':
      default:
        return compareNullableNumbers(timestamp(a.due_date), timestamp(b.due_date), 'asc')
    }
  })
}

export function TasksView({ tasks, contacts }: TasksViewProps) {
  const router = useRouter()
  const { setSuffix } = useBreadcrumbOverride()
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [quickFilters, setQuickFilters] = useState<TaskQuickFilters>(EMPTY_TASK_QUICK_FILTERS)
  const [sortBy, setSortBy] = useState<TaskSortKey>('due_date')
  const [calendarFilter, setCalendarFilter] = useState<CalendarFilterKey>('all')
  const [selectedDate, setSelectedDate] = useState<Date | null>(null)
  const [calendarOpen, setCalendarOpen] = useState(false)
  const [slideOpen, setSlideOpen] = useState(false)
  const [editingTask, setEditingTask] = useState<TaskRow | null>(null)
  const [isPending, startTransition] = useTransition()

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(SAVED_TASKS_VIEW_KEY)
      if (!raw) return

      const saved = JSON.parse(raw) as Partial<SavedTasksView>
      if (typeof saved.statusFilter === 'string') setStatusFilter(saved.statusFilter)
      if (saved.quickFilters) setQuickFilters(saved.quickFilters)
      if (saved.sortBy) setSortBy(saved.sortBy)
    } catch {
      window.localStorage.removeItem(SAVED_TASKS_VIEW_KEY)
    }
  }, [])

  // Push task count into the top-bar breadcrumb suffix
  useEffect(() => {
    setSuffix(<Badge variant="secondary">{tasks.length}</Badge>)
    return () => setSuffix(null)
  }, [tasks.length, setSuffix])

  const contactsMap = useMemo(
    () => new Map(contacts.map((c) => [c.id, c])),
    [contacts],
  )

  const taskDates = useMemo(() => {
    const s = new Set<string>()
    for (const t of tasks) {
      if (t.due_date) s.add(format(parseISO(t.due_date), 'yyyy-MM-dd'))
    }
    return s
  }, [tasks])

  const filtered = useMemo(() => {
    let rows = tasks
    if (statusFilter !== 'all') rows = rows.filter((t) => t.status === statusFilter)
    if (quickFilters.completion === 'incomplete') {
      rows = rows.filter((t) => t.status !== 'done' && t.status !== 'cancelled')
    }
    if (quickFilters.completion === 'completed') {
      rows = rows.filter((t) => t.status === 'done')
    }
    if (quickFilters.due !== 'all') {
      const now = new Date()
      const interval = quickFilters.due === 'this_week'
        ? { start: startOfDay(now), end: endOfWeek(now) }
        : { start: startOfWeek(addWeeks(now, 1)), end: endOfWeek(addWeeks(now, 1)) }

      rows = rows.filter((t) => {
        if (!t.due_date) return false
        return isWithinInterval(parseISO(t.due_date), interval)
      })
    }
    if (quickFilters.priority !== 'all') {
      rows = rows.filter((t) => t.priority === quickFilters.priority)
    }
    if (search.trim()) {
      const q = search.toLowerCase()
      rows = rows.filter((t) =>
        t.title.toLowerCase().includes(q) || t.description?.toLowerCase().includes(q),
      )
    }
    if (selectedDate) {
      rows = rows.filter((t) => t.due_date && isSameDay(parseISO(t.due_date), selectedDate))
    } else if (calendarFilter !== 'all') {
      const now = new Date()
      const today = startOfDay(now)
      const week = { start: today, end: endOfWeek(now) }
      const nextWeekStart = startOfWeek(addWeeks(now, 1))
      const nextWeek = { start: nextWeekStart, end: endOfWeek(nextWeekStart) }

      rows = rows.filter((t) => {
        if (calendarFilter === 'no_date') return !t.due_date
        if (!t.due_date) return false

        const due = parseISO(t.due_date)
        if (calendarFilter === 'overdue') {
          return due < today && t.status !== 'done' && t.status !== 'cancelled'
        }
        if (calendarFilter === 'today') return isSameDay(due, now)
        if (calendarFilter === 'this_week') return isWithinInterval(due, week)
        if (calendarFilter === 'next_week') return isWithinInterval(due, nextWeek)
        return true
      })
    }
    return sortTasks(rows, sortBy)
  }, [tasks, statusFilter, quickFilters, search, selectedDate, calendarFilter, sortBy])

  const groups = useMemo(() => groupTasks(filtered), [filtered])

  function handleNew() { setEditingTask(null); setSlideOpen(true) }
  function handleEdit(task: TaskRow) { setEditingTask(task); setSlideOpen(true) }

  function handleSaveView() {
    window.localStorage.setItem(
      SAVED_TASKS_VIEW_KEY,
      JSON.stringify({ statusFilter, quickFilters, sortBy } satisfies SavedTasksView),
    )
    toast.success('Task view saved')
  }

  function handleToggle(id: string) {
    startTransition(async () => {
      const res = await toggleTaskDone(id)
      if (!res.ok) toast.error(res.error)
      else router.refresh()
    })
  }

  function handleDelete(id: string) {
    startTransition(async () => {
      const res = await deleteTask(id)
      if (!res.ok) toast.error(res.error)
      else { toast.success('Task deleted'); router.refresh() }
    })
  }

  const calendar = (
    <CalendarPanel
      selectedDate={selectedDate}
      onSelectDate={(date) => {
        setSelectedDate(date)
        if (date) setCalendarFilter('all')
      }}
      calendarFilter={calendarFilter}
      onCalendarFilterChange={(filter) => {
        setSelectedDate(null)
        setCalendarFilter(filter)
      }}
      taskDates={taskDates}
    />
  )

  return (
    <div className="flex flex-col h-full">
      {/* Filter bar (includes Add Task button) */}
      <TasksFilterBar
        statusFilter={statusFilter}
        onStatusChange={setStatusFilter}
        quickFilters={quickFilters}
        onQuickFiltersChange={setQuickFilters}
        sortBy={sortBy}
        onSortChange={setSortBy}
        onSaveView={handleSaveView}
        search={search}
        onSearchChange={setSearch}
        calendarOpen={calendarOpen}
        onCalendarToggle={() => setCalendarOpen((p) => !p)}
        onAddTask={handleNew}
      />

      {/* Mobile calendar (collapsible) */}
      {calendarOpen && (
        <div className="lg:hidden border-b border-border p-4 shrink-0">
          {calendar}
          {(selectedDate || calendarFilter !== 'all') && (
            <p className="mt-2 text-xs text-muted-foreground">
              {filtered.length} task{filtered.length !== 1 ? 's' : ''} in this calendar view
            </p>
          )}
        </div>
      )}

      {/* Body */}
      <div className="flex flex-1 overflow-hidden">
        {/* Grouped list */}
        <div className="flex-1 overflow-y-auto py-4 px-4 sm:px-6 lg:px-8 space-y-6">
          {groups.length === 0 ? (
            <div className="flex items-center justify-center h-40 text-sm text-muted-foreground">
              No tasks match the current filters.
            </div>
          ) : (
            groups.map(({ key, tasks: groupTasks }) => (
              <TaskGroup
                key={key}
                groupKey={key}
                tasks={groupTasks}
                contactsMap={contactsMap}
                onToggle={handleToggle}
                onEdit={handleEdit}
                onDelete={handleDelete}
                isPending={isPending}
                sortBy={sortBy}
              />
            ))
          )}
        </div>

        {/* Desktop calendar sidebar */}
        <div className="hidden lg:flex flex-col w-72 shrink-0 border-l border-border p-4 overflow-y-auto">
          {calendar}
          {(selectedDate || calendarFilter !== 'all') && (
            <p className="mt-3 text-xs text-muted-foreground px-1">
              {filtered.length} task{filtered.length !== 1 ? 's' : ''} in this calendar view
            </p>
          )}
        </div>
      </div>

      <TaskSlideOver open={slideOpen} onOpenChange={setSlideOpen} task={editingTask} />
    </div>
  )
}

function CalendarPanel({
  selectedDate,
  onSelectDate,
  calendarFilter,
  onCalendarFilterChange,
  taskDates,
}: {
  selectedDate: Date | null
  onSelectDate: (date: Date | null) => void
  calendarFilter: CalendarFilterKey
  onCalendarFilterChange: (filter: CalendarFilterKey) => void
  taskDates: Set<string>
}) {
  return (
    <div className="space-y-3">
      <MiniCalendar
        selectedDate={selectedDate}
        onSelectDate={onSelectDate}
        taskDates={taskDates}
      />
      <div className="rounded-xl border border-white/10 bg-[#111113] p-3">
        <div className="mb-2 text-xs font-semibold text-muted-foreground">Calendar filters</div>
        <div className="flex flex-wrap gap-2">
          {CALENDAR_FILTERS.map((filter) => {
            const active = !selectedDate && calendarFilter === filter.value
            return (
              <button
                key={filter.value}
                type="button"
                onClick={() => onCalendarFilterChange(filter.value)}
                className={cn(
                  'h-7 rounded-full border px-2.5 text-xs font-medium transition-colors',
                  active
                    ? 'border-indigo-400/50 bg-indigo-500/15 text-indigo-200'
                    : 'border-white/15 bg-white/4 text-muted-foreground hover:border-white/25 hover:bg-white/8 hover:text-foreground',
                )}
              >
                {filter.label}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
