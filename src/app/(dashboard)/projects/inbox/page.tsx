import { Suspense } from 'react'
import { getMyProjectTasks } from '@/app/(dashboard)/projects/actions'
import { ProjectInboxClient } from './inbox-client'

export default async function ProjectInboxPage() {
  const tasks = await getMyProjectTasks()
  return (
    <Suspense fallback={null}>
      <ProjectInboxClient tasks={tasks} />
    </Suspense>
  )
}
