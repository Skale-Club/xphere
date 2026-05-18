import { getUnifiedCalls } from '../actions'
import { UnifiedCallTimeline } from '@/components/calls/unified-call-timeline'

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

type TypeFilter = 'all' | 'ai' | 'human'
type DirFilter = 'all' | 'inbound' | 'outbound' | 'missed'

const TYPES: TypeFilter[] = ['all', 'ai', 'human']
const DIRS: DirFilter[] = ['all', 'inbound', 'outbound', 'missed']

function parseType(v: string | undefined): TypeFilter {
  return (v && (TYPES as string[]).includes(v) ? v : 'all') as TypeFilter
}

function parseDir(v: string | undefined): DirFilter {
  return (v && (DIRS as string[]).includes(v) ? v : 'all') as DirFilter
}

export default async function CallsTimelinePage({ searchParams }: PageProps) {
  const sp = await searchParams
  const type = parseType(sp.type as string | undefined)
  const direction = parseDir(sp.direction as string | undefined)
  const q = typeof sp.q === 'string' ? sp.q : undefined
  const pageNum = Math.max(1, Number(sp.page ?? '1') || 1)

  const result = await getUnifiedCalls({
    page: pageNum,
    type: type === 'all' ? undefined : type,
    direction: direction === 'missed' ? undefined : direction === 'all' ? undefined : direction,
    missed: direction === 'missed',
    q,
  })

  return (
    <UnifiedCallTimeline
      rows={result.rows}
      total={result.total}
      page={result.page}
      pageSize={result.pageSize}
      currentType={type}
      currentDirection={direction}
      currentQuery={q}
    />
  )
}
