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
      <NotesGrid notes={notes} />
    </div>
  )
}
