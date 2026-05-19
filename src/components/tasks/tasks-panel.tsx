import { getTasks } from '@/app/(dashboard)/tasks/actions'
import { TasksTable } from './tasks-table'
import type { CrmEntityType } from '@/types/database'

interface TasksPanelProps {
  entityType: CrmEntityType
  entityId: string
}

export async function TasksPanel({ entityType, entityId }: TasksPanelProps) {
  const result = await getTasks({ entity_type: entityType, entity_id: entityId })
  const tasks = result.ok ? result.data : []

  return (
    <TasksTable
      tasks={tasks}
      prefill={{ entity_type: entityType, entity_id: entityId }}
      compact
    />
  )
}
