import { redirect } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { getUser } from '@/lib/supabase/server'
import { AdminSidebar } from '@/components/admin/admin-sidebar'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await getUser()
  if (!user) redirect('/')
  if (user.email !== process.env.PLATFORM_ADMIN_EMAIL) redirect('/dashboard')

  return (
    <div className="flex min-h-screen bg-bg-primary text-text-primary">
      <AdminSidebar />
      <div className="flex flex-1 flex-col min-h-screen">
        <header className="sticky top-0 z-30 h-14 px-6 flex items-center justify-between border-b border-border-subtle bg-bg-primary/80 backdrop-blur-md shrink-0">
          <div className="flex items-center gap-2">
            <span className="text-amber-500 dark:text-amber-400 font-semibold text-sm tracking-widest">
              SUPER ADMIN
            </span>
          </div>
          <div className="flex items-center gap-3">
            <Link
              href="/dashboard"
              className="inline-flex h-8 items-center gap-2 rounded-md border border-border-subtle px-3 text-xs font-medium text-text-secondary transition-colors duration-100 hover:bg-bg-tertiary hover:text-text-primary"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Back to dashboard
            </Link>
            <span className="text-text-tertiary text-xs">{user.email}</span>
          </div>
        </header>
        <main className="flex-1 min-h-0 overflow-auto">
          {children}
        </main>
      </div>
    </div>
  )
}
