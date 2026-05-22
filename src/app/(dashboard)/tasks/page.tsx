import { getTasks, getContactsForPicker } from './actions'
import { TasksView } from '@/components/tasks/tasks-view'

export default async function TasksPage() {
  const [tasksResult, contacts] = await Promise.all([
    getTasks(),
    getContactsForPicker(),
  ])
  const tasks = tasksResult.ok ? tasksResult.data : []

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)]">
      <TasksView tasks={tasks} contacts={contacts} />
    </div>
  )
}
