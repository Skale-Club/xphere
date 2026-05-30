import { redirect } from 'next/navigation'
import { Download } from 'lucide-react'

import { getUser } from '@/lib/supabase/server'
import { PageContainer, PageHeader } from '@/components/layout/page-header'
import { PwaInstallControl } from '@/components/pwa/pwa-install-control'

export default async function InstallPage() {
  const user = await getUser()
  if (!user) redirect('/')

  return (
    <PageContainer>
      <PageHeader
        eyebrow="App"
        eyebrowIcon={Download}
        title="Install app"
        description="Add Xphere to your home screen or desktop. Required for push notifications on iOS."
      />
      <PwaInstallControl />
    </PageContainer>
  )
}
