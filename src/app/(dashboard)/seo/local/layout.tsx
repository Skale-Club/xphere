import { SeoSectionGate } from '@/components/seo/section-gate'

export default function SeoLocalLayout({ children }: { children: React.ReactNode }) {
  return <SeoSectionGate section="local">{children}</SeoSectionGate>
}
