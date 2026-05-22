import { isPast, isToday, isTomorrow, parseISO, addDays, endOfDay } from 'date-fns'
import type { TaskRow } from '@/app/(dashboard)/tasks/actions'

export type GroupKey = 'overdue' | 'today' | 'tomorrow' | 'next_week' | 'future' | 'no_date'

export interface GroupMeta {
  label: string
  color: string
  dot: string
  ring: string
}

export const GROUP_META: Record<GroupKey, GroupMeta> = {
  overdue:   { label: 'Overdue',   color: 'text-red-400',    dot: 'bg-red-400',    ring: 'border-red-500/20' },
  today:     { label: 'Today',     color: 'text-indigo-400', dot: 'bg-indigo-400', ring: 'border-indigo-400/30' },
  tomorrow:  { label: 'Tomorrow',  color: 'text-indigo-300', dot: 'bg-indigo-300', ring: 'border-indigo-300/25' },
  next_week: { label: 'Next Week', color: 'text-indigo-200', dot: 'bg-indigo-200', ring: 'border-indigo-200/20' },
  future:    { label: 'Future',    color: 'text-indigo-200', dot: 'bg-indigo-200', ring: 'border-indigo-200/15' },
  no_date:   { label: 'No Date',   color: 'text-zinc-500',   dot: 'bg-zinc-500',   ring: 'border-zinc-700' },
}

export const GROUP_ORDER: GroupKey[] = ['overdue', 'today', 'tomorrow', 'next_week', 'future', 'no_date']

export function classifyTask(task: TaskRow): GroupKey {
  if (!task.due_date) return 'no_date'
  const d = parseISO(task.due_date)
  if (isToday(d)) return 'today'
  if (isTomorrow(d)) return 'tomorrow'
  if (isPast(d)) {
    return task.status === 'done' || task.status === 'cancelled' ? 'today' : 'overdue'
  }
  return d <= endOfDay(addDays(new Date(), 7)) ? 'next_week' : 'future'
}

export function groupTasks(tasks: TaskRow[]): Array<{ key: GroupKey; tasks: TaskRow[] }> {
  const buckets = Object.fromEntries(GROUP_ORDER.map((k) => [k, [] as TaskRow[]])) as Record<GroupKey, TaskRow[]>
  for (const t of tasks) buckets[classifyTask(t)].push(t)
  return GROUP_ORDER.filter((k) => buckets[k].length > 0).map((k) => ({ key: k, tasks: buckets[k] }))
}
