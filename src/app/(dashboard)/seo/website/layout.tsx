import { SeoSectionGate } from '@/components/seo/section-gate'

export default function SeoWebsiteLayout({ children }: { children: React.ReactNode }) {
  return <SeoSectionGate section="website">{children}</SeoSectionGate>
}
