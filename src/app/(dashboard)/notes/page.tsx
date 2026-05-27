import { getNotes } from './actions'
import { NotesGrid } from '@/components/notes/notes-grid'
import { PageContainer } from '@/components/layout/page-header'

interface NotesPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

export default async function NotesPage({ searchParams }: NotesPageProps) {
  const sp = await searchParams
  const search = typeof sp.search === 'string' ? sp.search : undefined

  const result = await getNotes({ search })
  const notes = result.ok ? result.data : []

  return (
    <PageContainer className="space-y-6">
      <NotesGrid notes={notes} />
    </PageContainer>
  )
}
