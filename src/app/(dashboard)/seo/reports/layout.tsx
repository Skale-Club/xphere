import { SeoSectionGate } from '@/components/seo/section-gate'

export default function SeoReportsLayout({ children }: { children: React.ReactNode }) {
  return <SeoSectionGate section="reports">{children}</SeoSectionGate>
}
