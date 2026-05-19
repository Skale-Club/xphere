import { FileText } from 'lucide-react'
import { getNotes } from './actions'
import { NotesGrid } from '@/components/notes/notes-grid'

interface NotesPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

export default async function NotesPage({ searchParams }: NotesPageProps) {
  const sp = await searchParams
  const search = typeof sp.search === 'string' ? sp.search : undefined

  const result = await getNotes({ search })
  const notes = result.ok ? result.data : []

  return (
    <div className="mx-auto w-full max-w-none px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2 text-[12px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
          <FileText className="h-3.5 w-3.5 text-accent" />
          <span>CRM</span>
        </div>
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
          <div>
            <h1 className="text-[28px] sm:text-[32px] font-semibold tracking-tight">
              Notes
            </h1>
            <p className="mt-1 text-[14px] text-muted-foreground">
              Capture context, meeting summaries, and insights linked to your CRM records.
            </p>
          </div>
        </div>
      </div>

      <NotesGrid notes={notes} />
    </div>
  )
}
