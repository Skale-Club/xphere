import { getTasks } from './actions'
import { TasksTable } from '@/components/tasks/tasks-table'

interface TasksPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

export default async function TasksPage({ searchParams }: TasksPageProps) {
  const sp = await searchParams

  const filters = {
    status: typeof sp.status === 'string' ? sp.status as 'todo' | 'in_progress' | 'done' | 'cancelled' : undefined,
    priority: typeof sp.priority === 'string' ? sp.priority as 'low' | 'medium' | 'high' | 'urgent' : undefined,
    q: typeof sp.q === 'string' ? sp.q : undefined,
  }

  const result = await getTasks(filters)
  const tasks = result.ok ? result.data : []

  return (
    <div className="mx-auto w-full max-w-none px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      <TasksTable tasks={tasks} />
    </div>
  )
}
