import { PageContainer } from '@/components/layout/page-header'
import { TableSkeleton } from '@/components/skeletons'

export default function Loading() {
  return (
    <PageContainer>
      <TableSkeleton rows={3} columns={6} />
    </PageContainer>
  )
}
