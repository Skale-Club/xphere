import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

import { Sidebar } from '@/components/layout/sidebar'
import { SidebarStateProvider } from '@/components/layout/sidebar-context'
import { TopBar } from '@/components/layout/top-bar'
import { CommandPaletteProvider } from '@/components/command-palette'
import { BreadcrumbOverrideProvider } from '@/components/layout/breadcrumb-override-context'
import { createClient, getUser } from '@/lib/supabase/server'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const user = await getUser()
  if (!user) redirect('/login')

  // Read active org from cookie — no DB call on normal navigation
  const jar = await cookies()
  const raw = jar.get('vo_active_org')?.value
  let activeOrgId: string | null = null
  let activeOrgName: string | null = null

  if (raw) {
    try {
      const parsed = JSON.parse(raw) as { id: string; name: string }
      activeOrgId = parsed.id ?? null
      activeOrgName = parsed.name ?? null
    } catch {
      // malformed cookie — ignore, will fall back to DB below
    }
  }

  // First load (no cookie): seed from DB
  if (!activeOrgId) {
    const supabase = await createClient()
    const { data: orgId } = await supabase.rpc('get_current_org_id')
    if (orgId) {
      const { data: org } = await supabase
        .from('organizations')
        .select('id, name')
        .eq('id', orgId as string)
        .single()
      if (org) {
        activeOrgId = org.id
        activeOrgName = org.name
      }
    }
  }

  const isPlatformAdmin = user.email === process.env.PLATFORM_ADMIN_EMAIL

  return (
    <BreadcrumbOverrideProvider>
      <SidebarStateProvider>
        <CommandPaletteProvider>
          <div className="flex min-h-dvh bg-bg-primary">
            <Sidebar
              user={user}
              isPlatformAdmin={isPlatformAdmin}
              activeOrgId={activeOrgId}
              activeOrgName={activeOrgName}
            />
            <div className="flex min-w-0 flex-1 flex-col">
              <TopBar />
              <main className="flex-1 overflow-auto">{children}</main>
            </div>
          </div>
        </CommandPaletteProvider>
      </SidebarStateProvider>
    </BreadcrumbOverrideProvider>
  )
}
