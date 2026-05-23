import { SplitPageSkeleton } from '@/components/skeletons/page-skeleton'

export default function OutboundLoading() {
  return <SplitPageSkeleton leftRows={5} rightCard={false} />
}