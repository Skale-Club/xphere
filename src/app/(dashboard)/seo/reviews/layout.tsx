import { SeoSectionGate } from '@/components/seo/section-gate'

export default function SeoReviewsLayout({ children }: { children: React.ReactNode }) {
  return <SeoSectionGate section="reviews">{children}</SeoSectionGate>
}
