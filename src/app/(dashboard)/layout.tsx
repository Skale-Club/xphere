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
import { CopilotPanel } from '@/components/copilot/copilot-panel'
import { DialpadAvailabilityProvider } from '@/components/phone/dialpad-availability-context'
import { PwaInstallProvider } from '@/components/pwa/pwa-install-context'
import { PwaInstallDialog } from '@/components/pwa/pwa-install-dialog'
import { createClient, getUser } from '@/lib/supabase/server'
import { isDemoSession } from '@/lib/demo/guard'
import { DemoBanner } from '@/components/demo/demo-banner'
import { getMyPermissions, getRbacContext } from '@/lib/rbac/server'
import { getOrgSettings } from '@/lib/org/settings'
import { getActiveOrg } from '@/lib/org/active-org'
import { OrgSettingsProvider } from '@/components/providers/org-settings-provider'
import { getOrgBranding } from '@/lib/branding.server'
import { getFaviconUrl } from '@/lib/seo'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const user = await getUser()
  if (!user) redirect('/')

  // Resolve the active org from the DB (get_current_org_id) — the SAME source
  // RLS uses to scope data. We intentionally do NOT read the vo_active_org
  // cookie for display: it can drift from the DB (switching on another device,
  // a half-completed refresh) and produce a split-brain where the topbar/theme
  // show one org while the data belongs to another. Single source of truth.
  const active = await getActiveOrg()
  const activeOrgId: string | null = active?.id ?? null
  const activeOrgName: string | null = active?.name ?? null

  // getOrgBranding already swallows errors internally, but keep a belt
  // here too in case the import-time client construction fails.
  let branding
  try {
    branding = await getOrgBranding(activeOrgId)
  } catch {
    const { DEFAULT_BRANDING } = await import('@/lib/branding')
    branding = DEFAULT_BRANDING
  }

  // Fallback to platform favicon when the org has no custom logo set.
  // Order: org logo → platform favicon → "X" placeholder (handled in Sidebar).
  const platformFaviconUrl = await getFaviconUrl()
  const effectiveLogoUrl = branding.logoUrl ?? platformFaviconUrl

  const isPlatformAdmin = user.email === process.env.PLATFORM_ADMIN_EMAIL
  const rbacContext = await getRbacContext()
  const isOrgAdmin = rbacContext.role === 'owner' || rbacContext.role === 'admin'
  const isDemo = await isDemoSession()

  // RBAC: which nav items this user may see. null = unrestricted (Owner /
  // platform / unconfigured org). Fail open on error — RLS still guards data.
  const navPermissions = await getMyPermissions().catch(() => null)

  // Decide whether to mount the Twilio Voice SDK Device for this user.
  // Only users in routing_mode='browser' incur the SDK bundle/connection.
  let browserVoiceEnabled = false
  // True when the org has at least one active twilio_phone_numbers row. The
  // top bar uses this to hide the dial-pad button on orgs that haven't
  // connected a number yet (matches the /calls onboarding gate behavior).
  let hasPhoneNumber = false
  try {
    const supabase = await createClient()
    const [{ data: settings }, { count: numberCount }] = await Promise.all([
      supabase
        .from('call_settings')
        .select('routing_mode, twilio_client_identity')
        .eq('user_id', user.id)
        .maybeSingle(),
      supabase
        .from('twilio_phone_numbers')
        .select('id', { count: 'exact', head: true })
        .eq('is_active', true)
        .eq('capability_voice', true),
    ])
    browserVoiceEnabled = settings?.routing_mode === 'browser' && Boolean(settings.twilio_client_identity)
    hasPhoneNumber = (numberCount ?? 0) > 0
  } catch {
    browserVoiceEnabled = false
    hasPhoneNumber = false
  }

  // Copilot visibility:
  //  copilotEnabled  — org-level toggle (settings.copilot_enabled, default true)
  //                    false → hide both launcher and panel entirely
  //  hasCopilotProvider — at least one active AI key exists (org or platform)
  //                       false → show panel but surface a setup notice inside
  let copilotEnabled = true
  let hasCopilotProvider = false
  try {
    const supabase = await createClient()
    if (activeOrgId) {
      const [{ data: orgData }, { count: orgProviderCount }] = await Promise.all([
        supabase
          .from('organizations')
          .select('settings')
          .eq('id', activeOrgId)
          .maybeSingle(),
        supabase
          .from('integrations')
          .select('id', { count: 'exact', head: true })
          .eq('organization_id', activeOrgId)
          .in('provider', ['openrouter', 'anthropic'])
          .eq('is_active', true),
      ])
      const orgSettings = (orgData?.settings ?? {}) as Record<string, unknown>
      copilotEnabled = orgSettings.copilot_enabled !== false // default true
      hasCopilotProvider = (orgProviderCount ?? 0) > 0
    }
    // Platform-level key fallback (super-admin key covers all orgs)
    if (copilotEnabled && !hasCopilotProvider) {
      const { count: platformCount } = await supabase
        .from('platform_settings')
        .select('key', { count: 'exact', head: true })
        .in('key', ['OPENROUTER_API_KEY', 'ANTHROPIC_API_KEY'])
      hasCopilotProvider = (platformCount ?? 0) > 0
    }
  } catch {
    copilotEnabled = true   // fail open
    hasCopilotProvider = false
  }

  // Org timezone + currency → client context so client-side date/money
  // formatting matches server rendering (org is the source of truth).
  const orgSettings = await getOrgSettings()

  return (
    <BreadcrumbOverrideProvider>
      <OrgSettingsProvider value={{ timezone: orgSettings.timezone, currency: orgSettings.currency }}>
      <SidebarStateProvider>
        <CommandPaletteProvider>
          <DialpadAvailabilityProvider available={hasPhoneNumber}>
          <PwaInstallProvider>
          <VoiceDeviceShell enabled={browserVoiceEnabled}>
            <BrandingStyle branding={branding} />
            {effectiveLogoUrl && (
              // eslint-disable-next-line @next/next/no-sync-scripts
              <link rel="icon" href={effectiveLogoUrl} />
            )}
            <CelebrationProvider>
              <div className="flex min-h-dvh bg-bg-primary">
                <Sidebar
                  user={user}
                  activeOrgId={activeOrgId}
                  activeOrgName={activeOrgName}
                  brandName={branding.appName}
                  logoUrl={effectiveLogoUrl}
                  isPlatformAdmin={isPlatformAdmin}
                  isOrgAdmin={isOrgAdmin}
                  isDemo={isDemo}
                  navPermissions={navPermissions}
                />
                <div className="flex min-w-0 flex-1 h-dvh overflow-hidden">
                  <main className="flex flex-1 min-h-0 flex-col overflow-auto">
                    {isDemo && <DemoBanner />}
                    <TopBar
                      activeOrgId={activeOrgId}
                      activeOrgName={activeOrgName}
                      activeOrgLogo={branding.logoUrl}
                      isPlatformAdmin={isPlatformAdmin}
                      userId={user.id}
                      hasPhoneNumber={hasPhoneNumber}
                    />
                    <div className="flex-1 min-h-0">
                      <PageTransition>{children}</PageTransition>
                    </div>
                  </main>
                  {copilotEnabled && <CopilotPanel hasProvider={hasCopilotProvider} />}
                </div>
              </div>
              <OnboardingTour />
              <DialPadPanelServer />
              {copilotEnabled && <CopilotShell />}
              <PwaInstallDialog />
            </CelebrationProvider>
          </VoiceDeviceShell>
          </PwaInstallProvider>
          </DialpadAvailabilityProvider>
        </CommandPaletteProvider>
      </SidebarStateProvider>
      </OrgSettingsProvider>
    </BreadcrumbOverrideProvider>
  )
}
