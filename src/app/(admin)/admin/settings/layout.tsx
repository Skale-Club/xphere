import { SubSidebarLayout } from '@/components/layout/sub-sidebar'
import { AdminSettingsSubNav } from '@/components/admin/admin-settings-sub-nav'

export default function AdminSettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <SubSidebarLayout
      storageKey="admin-sidebar:settings"
      title="Settings"
      expandedWidth={176}
      nav={<AdminSettingsSubNav />}
    >
      {children}
    </SubSidebarLayout>
  )
}
