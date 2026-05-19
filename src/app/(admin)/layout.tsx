import { redirect } from 'next/navigation'
import { getUser } from '@/lib/supabase/server'
import { AdminSidebar } from '@/components/admin/admin-sidebar'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await getUser()
  if (!user) redirect('/login')
  if (user.email !== process.env.PLATFORM_ADMIN_EMAIL) redirect('/dashboard')

  return (
    <div className="dark flex min-h-screen bg-[#0A0A0B] text-[#FAFAFA]">
      <AdminSidebar />
      <div className="flex flex-1 flex-col min-h-screen">
        <header className="h-14 px-6 flex items-center justify-between border-b border-[#2A2A2F] bg-[#0A0A0B] shrink-0">
          <div className="flex items-center gap-2">
            <span className="bg-gradient-to-r from-red-500 to-orange-500 bg-clip-text text-transparent font-semibold text-sm tracking-widest">
              SUPER ADMIN
            </span>
          </div>
          <span className="text-[#71717A] text-xs">{user.email}</span>
        </header>
        <main className="flex-1 min-h-0 overflow-auto">
          {children}
        </main>
      </div>
    </div>
  )
}
