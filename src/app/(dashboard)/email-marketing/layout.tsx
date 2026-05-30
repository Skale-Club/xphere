import { redirectIfDemo } from '@/lib/demo/route-guard'

// Sensitive area: hidden from public read-only demo visitors.
export default async function Layout({ children }: { children: React.ReactNode }) {
  await redirectIfDemo()
  return <>{children}</>
}
