import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

import { Sidebar } from '@/components/layout/sidebar'
import { SidebarStateProvider } from '@/components/layout/sidebar-context'
import { TopBar } from '@/components/layout/top-bar'
import { CommandPaletteProvider } from '@/components/command-palette'
import { BreadcrumbOverrideProvider } from '@/components/layout/breadcrumb-override-context'
import { VoiceDeviceShell } from '@/components/calls/voice-device-shell'
import { DialPadPanelServer } from '@/components/calls/dial-pad-panel-server'
import { BrandingStyle } from '@/components/layout/branding-style'
import { CelebrationProvider } from '@/components/design-system/celebration-provider'
import { OnboardingTour } from '@/components/onboarding/tour'
import { PageTransition } from '@/components/layout/page-transition'
import { CopilotShell } from '@/components/copilot/copilot-launcher'
import { createClient, getUser } from '@/lib/supabase/server'
import { getOrgBranding } from '@/lib/branding.server'

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

  // First load (no cookie): seed from DB. Any failure here is non-fatal —
  // the user can still navigate; we just won't pre-fill the org switcher.
  if (!activeOrgId) {
    try {
      const supabase = await createClient()
      const { data: orgId } = await supabase.rpc('get_current_org_id')
      if (orgId) {
        const { data: org } = await supabase
          .from('organizations')
          .select('id, name')
          .eq('id', orgId as string)
          .maybeSingle()
        if (org) {
          activeOrgId = org.id
          activeOrgName = org.name
        }
      }
    } catch {
      // ignore — fall back to default-shell render
    }
  }

  // getOrgBranding already swallows errors internally, but keep a belt
  // here too in case the import-time client construction fails.
  let branding
  try {
    branding = await getOrgBranding(activeOrgId)
  } catch {
    const { DEFAULT_BRANDING } = await import('@/lib/branding')
    branding = DEFAULT_BRANDING
  }

  const isPlatformAdmin = user.email === process.env.PLATFORM_ADMIN_EMAIL

  // Decide whether to mount the Twilio Voice SDK Device for this user.
  // Only users in routing_mode='browser' incur the SDK bundle/connection.
  let browserVoiceEnabled = false
  try {
    const supabase = await createClient()
    const { data: settings } = await supabase
      .from('call_settings')
      .select('routing_mode, twilio_client_identity')
      .eq('user_id', user.id)
      .maybeSingle()
    browserVoiceEnabled = settings?.routing_mode === 'browser' && Boolean(settings.twilio_client_identity)
  } catch {
    browserVoiceEnabled = false
  }

  return (
    <BreadcrumbOverrideProvider>
      <SidebarStateProvider>
        <CommandPaletteProvider>
          <VoiceDeviceShell enabled={browserVoiceEnabled}>
            <BrandingStyle branding={branding} />
            {branding.logoUrl && (
              // eslint-disable-next-line @next/next/no-sync-scripts
              <link rel="icon" href={branding.logoUrl} />
            )}
            <CelebrationProvider>
              <div className="flex min-h-dvh bg-bg-primary">
                <Sidebar
                  user={user}
                  isPlatformAdmin={isPlatformAdmin}
                  activeOrgId={activeOrgId}
                  activeOrgName={activeOrgName}
                  brandName={branding.appName}
                  logoUrl={branding.logoUrl}
                />
                <div className="flex min-w-0 flex-1 flex-col h-dvh">
                  <TopBar
                    activeOrgId={activeOrgId}
                    activeOrgName={activeOrgName}
                    isPlatformAdmin={isPlatformAdmin}
                  />
                  <main className="flex-1 min-h-0 overflow-auto">
                    <div className="h-full">
                      <PageTransition>{children}</PageTransition>
                    </div>
                  </main>
                </div>
              </div>
              <OnboardingTour />
              <DialPadPanelServer />
              <CopilotShell />
            </CelebrationProvider>
          </VoiceDeviceShell>
        </CommandPaletteProvider>
      </SidebarStateProvider>
    </BreadcrumbOverrideProvider>
  )
}
