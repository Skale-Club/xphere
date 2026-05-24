import { parseISO } from 'date-fns'
import { cn } from '@/lib/utils'
import { TaskListItem } from './task-list-item'
import { GROUP_META, type GroupKey } from './task-groups-utils'
import type { TaskRow, ContactOption } from '@/app/(dashboard)/tasks/actions'
import type { TaskSortKey } from './tasks-filter-bar'

interface TaskGroupProps {
  groupKey: GroupKey
  tasks: TaskRow[]
  contactsMap: Map<string, ContactOption>
  onToggle: (id: string) => void
  onEdit: (task: TaskRow) => void
  onDelete: (id: string) => void
  isPending: boolean
  sortBy: TaskSortKey
}

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

function sortGroupTasks(tasks: TaskRow[], sortBy: TaskSortKey) {
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

export function TaskGroup({ groupKey, tasks, contactsMap, onToggle, onEdit, onDelete, isPending, sortBy }: TaskGroupProps) {
  const meta = GROUP_META[groupKey]
  const sortedTasks = sortGroupTasks(tasks, sortBy)

  return (
    <div>
      <div className="flex items-center gap-2 mb-1 px-4">
        <span className={cn('h-2 w-2 rounded-full shrink-0', meta.dot)} />
        <span className={cn('text-xs font-semibold uppercase tracking-wide', meta.color)}>
          {meta.label}
        </span>
        <span className="text-xs text-muted-foreground">· {tasks.length}</span>
      </div>
      <div className={cn('mb-2 ml-4 border-t', meta.ring)} />
      <div className="divide-y divide-white/[0.06]">
        {sortedTasks.map((task) => {
          const contact =
            task.entity_type === 'contact' && task.entity_id
              ? (contactsMap.get(task.entity_id) ?? null)
              : null
          return (
            <TaskListItem
              key={task.id}
              task={task}
              contact={contact}
              onToggle={onToggle}
              onEdit={onEdit}
              onDelete={onDelete}
              isPending={isPending}
            />
          )
        })}
      </div>
    </div>
  )
}
