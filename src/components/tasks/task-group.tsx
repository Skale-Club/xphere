import { cn } from '@/lib/utils'
import { TaskListItem } from './task-list-item'
import { GROUP_META, type GroupKey } from './task-groups-utils'
import type { TaskRow, ContactOption } from '@/app/(dashboard)/tasks/actions'

interface TaskGroupProps {
  groupKey: GroupKey
  tasks: TaskRow[]
  contactsMap: Map<string, ContactOption>
  onToggle: (id: string) => void
  onEdit: (task: TaskRow) => void
  onDelete: (id: string) => void
  isPending: boolean
}

export function TaskGroup({ groupKey, tasks, contactsMap, onToggle, onEdit, onDelete, isPending }: TaskGroupProps) {
  const meta = GROUP_META[groupKey]

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
      <div className="space-y-0.5">
        {tasks.map((task) => {
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
