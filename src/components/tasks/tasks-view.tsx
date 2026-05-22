'use client'

import { useState, useTransition, useMemo, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { format, parseISO, isSameDay } from 'date-fns'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'

import { MiniCalendar } from './mini-calendar'
import { TaskGroup } from './task-group'
import { TasksFilterBar } from './tasks-filter-bar'
import { TaskSlideOver } from './task-slide-over'
import { groupTasks } from './task-groups-utils'
import { toggleTaskDone, deleteTask } from '@/app/(dashboard)/tasks/actions'
import type { TaskRow, ContactOption } from '@/app/(dashboard)/tasks/actions'
import { useBreadcrumbOverride } from '@/components/layout/breadcrumb-override-context'

interface TasksViewProps {
  tasks: TaskRow[]
  contacts: ContactOption[]
}

export function TasksView({ tasks, contacts }: TasksViewProps) {
  const router = useRouter()
  const { setSuffix } = useBreadcrumbOverride()
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [selectedDate, setSelectedDate] = useState<Date | null>(null)
  const [calendarOpen, setCalendarOpen] = useState(false)
  const [slideOpen, setSlideOpen] = useState(false)
  const [editingTask, setEditingTask] = useState<TaskRow | null>(null)
  const [isPending, startTransition] = useTransition()

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
    if (search.trim()) {
      const q = search.toLowerCase()
      rows = rows.filter((t) =>
        t.title.toLowerCase().includes(q) || t.description?.toLowerCase().includes(q),
      )
    }
    if (selectedDate) {
      rows = rows.filter((t) => t.due_date && isSameDay(parseISO(t.due_date), selectedDate))
    }
    return rows
  }, [tasks, statusFilter, search, selectedDate])

  const groups = useMemo(() => groupTasks(filtered), [filtered])

  function handleNew() { setEditingTask(null); setSlideOpen(true) }
  function handleEdit(task: TaskRow) { setEditingTask(task); setSlideOpen(true) }

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
    <MiniCalendar
      selectedDate={selectedDate}
      onSelectDate={setSelectedDate}
      taskDates={taskDates}
    />
  )

  return (
    <div className="flex flex-col h-full">
      {/* Filter bar (includes Add Task button) */}
      <TasksFilterBar
        statusFilter={statusFilter}
        onStatusChange={setStatusFilter}
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
          {selectedDate && (
            <p className="mt-2 text-xs text-muted-foreground">
              {filtered.length} task{filtered.length !== 1 ? 's' : ''} on this day
            </p>
          )}
        </div>
      )}

      {/* Body */}
      <div className="flex flex-1 overflow-hidden">
        {/* Grouped list */}
        <div className="flex-1 overflow-y-auto py-4 px-2 sm:px-4 space-y-6">
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
              />
            ))
          )}
        </div>

        {/* Desktop calendar sidebar */}
        <div className="hidden lg:flex flex-col w-72 shrink-0 border-l border-border p-4 overflow-y-auto">
          {calendar}
          {selectedDate && (
            <p className="mt-3 text-xs text-muted-foreground px-1">
              {filtered.length} task{filtered.length !== 1 ? 's' : ''} on this day
            </p>
          )}
        </div>
      </div>

      <TaskSlideOver open={slideOpen} onOpenChange={setSlideOpen} task={editingTask} />
    </div>
  )
}
