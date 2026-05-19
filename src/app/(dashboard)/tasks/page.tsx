import { CheckSquare } from 'lucide-react'
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
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2 text-[12px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
          <CheckSquare className="h-3.5 w-3.5 text-accent" />
          <span>CRM</span>
        </div>
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
          <div>
            <h1 className="text-[28px] sm:text-[32px] font-semibold tracking-tight">
              Tasks
            </h1>
            <p className="mt-1 text-[14px] text-muted-foreground">
              Track follow-ups and action items across all your CRM records.
            </p>
          </div>
        </div>
      </div>

      <TasksTable tasks={tasks} />
    </div>
  )
}
