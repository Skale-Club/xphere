import { redirectIfDemo } from '@/lib/demo/route-guard'

export default async function Layout({ children }: { children: React.ReactNode }) {
  await redirectIfDemo()
  return <>{children}</>
}
