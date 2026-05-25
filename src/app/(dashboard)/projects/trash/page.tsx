// R08: Projects trash. Lists soft-deleted projects with restore +
// permanent-delete + empty-trash controls. Mirrors workflows/trash/page.tsx.

import Link from 'next/link'
import { ArrowLeft, Trash2 } from 'lucide-react'
import { formatDistanceToNow, parseISO } from 'date-fns'

import { createClient } from '@/lib/supabase/server'
import { PageContainer, PageHeader } from '@/components/layout/page-header'
import { TrashRowActions, EmptyTrashButton } from './trash-actions'

interface TrashedProject {
  id: string
  name: string
  color: string | null
  deleted_at: string
}

export default async function ProjectsTrashPage() {
  const supabase = await createClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any
  const { data: orgId } = await supabase.rpc('get_current_org_id')

  const { data: rows } = orgId
    ? await db
        .from('projects')
        .select('id, name, color, deleted_at')
        .eq('org_id', orgId as string)
        .not('deleted_at', 'is', null)
        .order('deleted_at', { ascending: false })
    : { data: [] as TrashedProject[] | null }

  const trashed = (rows ?? []) as TrashedProject[]

  return (
    <PageContainer>
      <div className="mb-3">
        <Link
          href="/projects"
          className="inline-flex items-center gap-1 text-xs text-text-tertiary hover:text-text-primary"
        >
          <ArrowLeft className="h-3 w-3" />
          Back to projects
        </Link>
      </div>
      <PageHeader
        eyebrow="Projects"
        eyebrowIcon={Trash2}
        title="Trash"
        description="Projects here are hidden from the main list. They can be restored, or deleted forever."
      />

      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-text-secondary">
          {trashed.length === 0
            ? 'Trash is empty.'
            : `${trashed.length} project${trashed.length !== 1 ? 's' : ''}`}
        </p>
        <EmptyTrashButton disabled={trashed.length === 0} />
      </div>

      {trashed.length === 0 ? (
        <div className="rounded-lg border border-border-subtle bg-bg-secondary/30 p-12 text-center">
          <Trash2 className="mx-auto h-8 w-8 text-text-tertiary mb-3" />
          <p className="text-sm text-text-secondary">No projects in the trash.</p>
        </div>
      ) : (
        <div className="rounded-lg border border-border-subtle bg-bg-secondary/30 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-bg-secondary/60">
              <tr className="text-xs text-text-tertiary uppercase tracking-wide">
                <th className="text-left font-medium px-4 py-2.5">Name</th>
                <th className="text-left font-medium px-4 py-2.5">Deleted</th>
                <th className="text-right font-medium px-4 py-2.5">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-subtle">
              {trashed.map((p) => (
                <tr key={p.id}>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        className="inline-block h-3 w-3 rounded-full shrink-0"
                        style={{ backgroundColor: p.color ?? '#6366f1' }}
                      />
                      <p className="text-sm font-medium text-text-primary truncate">{p.name}</p>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-[12px] text-text-secondary">
                    {formatDistanceToNow(parseISO(p.deleted_at), { addSuffix: true })}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end">
                      <TrashRowActions projectId={p.id} name={p.name} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </PageContainer>
  )
}
