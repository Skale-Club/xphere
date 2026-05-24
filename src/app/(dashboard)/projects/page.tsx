import { Suspense } from 'react'
import Link from 'next/link'
import { FolderKanban, Plus } from 'lucide-react'

import { getProjects } from './actions'
import { NewProjectDialog } from '@/components/projects/new-project-dialog'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'

async function ProjectsList() {
  const projects = await getProjects()

  if (projects.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center gap-4">
        <FolderKanban className="h-12 w-12 text-muted-foreground/40" />
        <div>
          <p className="text-lg font-medium">You don&apos;t have any projects yet</p>
          <p className="text-sm text-muted-foreground mt-1">Create your first project to start organizing tasks</p>
        </div>
        <NewProjectDialog>
          <Button size="sm">
            <Plus className="h-4 w-4 mr-1.5" />
            New Project
          </Button>
        </NewProjectDialog>
      </div>
    )
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {projects.map((project) => (
        <Link key={project.id} href={`/projects/${project.id}`}>
          <Card className="hover:border-accent/50 transition-colors cursor-pointer h-full">
            <CardContent className="p-5">
              <div className="flex items-start gap-3">
                <div
                  className="mt-0.5 h-3 w-3 rounded-full shrink-0"
                  style={{ backgroundColor: project.color ?? '#6366f1' }}
                />
                <div className="min-w-0">
                  <p className="font-medium leading-tight truncate">{project.name}</p>
                  {project.description && (
                    <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{project.description}</p>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        </Link>
      ))}
    </div>
  )
}

export default function ProjectsPage() {
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-2 px-4 sm:px-6 lg:px-8 pt-6 pb-6">
        <div>
          <h1 className="text-xl font-semibold">Projects</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Manage your team&apos;s projects and tasks</p>
        </div>
        <NewProjectDialog>
          <Button size="sm">
            <Plus className="h-4 w-4 mr-1.5" />
            New Project
          </Button>
        </NewProjectDialog>
      </div>

      <div className="flex-1 overflow-auto px-4 sm:px-6 lg:px-8 pb-8">
        <Suspense fallback={
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Card key={i}>
                <CardContent className="p-5 h-24 animate-pulse" />
              </Card>
            ))}
          </div>
        }>
          <ProjectsList />
        </Suspense>
      </div>
    </div>
  )
}
