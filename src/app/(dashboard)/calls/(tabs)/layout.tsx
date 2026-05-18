import { redirect } from 'next/navigation'
import { Phone } from 'lucide-react'

import { getUser } from '@/lib/supabase/server'
import { PageContainer, PageHeader } from '@/components/layout/page-header'
import { CallsNav } from './_nav'

export default async function CallsLayout({ children }: { children: React.ReactNode }) {
  const user = await getUser()
  if (!user) redirect('/login')

  return (
    <PageContainer>
      <PageHeader
        eyebrow="Engage"
        eyebrowIcon={Phone}
        title="Calls"
        description="Every AI and human call across your workspace — with transcripts, recordings, routing and campaigns."
      />
      <CallsNav />
      <div className="pt-2">{children}</div>
    </PageContainer>
  )
}
