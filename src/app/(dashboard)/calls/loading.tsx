import { SplitPageSkeleton } from '@/components/skeletons/page-skeleton'

// Route-level loading only fires on hard navigation, not on client-side
// `?call=` param changes. The call-detail dialog body has its own in-page
// <Suspense> boundary (see CallDetailSkeleton in (hub)/page.tsx).
export default function CallsLoading() {
  return <SplitPageSkeleton leftRows={10} />
}