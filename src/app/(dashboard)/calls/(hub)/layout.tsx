import { redirect } from 'next/navigation'

import { getUser } from '@/lib/supabase/server'
import { PageContainer } from '@/components/layout/page-header'
import { TooltipProvider } from '@/components/ui/tooltip'

export const metadata = { title: 'Calls' }

export default async function CallsHubLayout({ children }: { children: React.ReactNode }) {
  const user = await getUser()
  if (!user) redirect('/')

  return (
    <TooltipProvider delayDuration={200}>
      <PageContainer className="pt-6">{children}</PageContainer>
    </TooltipProvider>
  )
}
