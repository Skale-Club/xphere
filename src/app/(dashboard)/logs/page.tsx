import { notFound, redirect } from 'next/navigation'
import { getUser } from '@/lib/supabase/server'

export default async function LegacyLogsPage() {
  const user = await getUser()

  if (user?.email && process.env.PLATFORM_ADMIN_EMAIL && user.email === process.env.PLATFORM_ADMIN_EMAIL) {
    redirect('/admin/logs')
  }

  notFound()
}
