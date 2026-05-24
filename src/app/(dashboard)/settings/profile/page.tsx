import { redirect } from 'next/navigation'
import { User } from 'lucide-react'

import { getUser } from '@/lib/supabase/server'
import { PageContainer, PageHeader } from '@/components/layout/page-header'
import { ProfileForm } from '@/components/settings/profile-form'

export default async function ProfilePage() {
  const user = await getUser()
  if (!user) redirect('/')

  return (
    <PageContainer>
      <PageHeader
        eyebrow="Account"
        eyebrowIcon={User}
        title="Profile"
        description="Update your personal information and password."
      />
      <ProfileForm
        initial={{
          email: user.email ?? '',
          full_name: (user.user_metadata?.full_name as string | undefined) ?? '',
          avatar_url: (user.user_metadata?.avatar_url as string | undefined) ?? null,
        }}
      />
    </PageContainer>
  )
}
