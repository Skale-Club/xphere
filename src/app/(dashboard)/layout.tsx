import { redirect } from 'next/navigation'
import { Suspense } from 'react'

import { InviteResultToast } from '@/components/invites/invite-result-toast'
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
import { getUserOrgs } from '@/app/(dashboard)/organizations/actions'
import { OrgSettingsProvider } from '@/components/providers/org-settings-provider'
import { getOrgBranding } from '@/lib/branding.server'
import { getFaviconUrl } from '@/lib/seo'
import { isBillingEnforced } from '@/lib/billing/config'
import { getEntitlements } from '@/lib/billing/entitlements'
import { resolveCreditsVisibility } from '@/lib/billing/credits'
import { shouldBlockForBilling } from '@/lib/billing/guards'
import { PLAN_CATALOG } from '@/lib/billing/catalog'
import { BillingPaywall } from '@/components/billing/billing-paywall'

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

  // Billing enforcement (flag-gated; a no-op until BILLING_ENFORCEMENT_ENABLED).
  // When on, resolve the org's entitlements to (a) gate nav by plan feature and
  // (b) paywall the whole app once the trial/plan lapses. Platform admins bypass.
  const entitlements = isBillingEnforced() ? await getEntitlements() : null
  const entitledFeatures = entitlements ? [...entitlements.features] : null
  const billingBlocked = entitlements
    ? shouldBlockForBilling(entitlements.status, isPlatformAdmin)
    : false
  const paywallPlans = billingBlocked
    ? Object.values(PLAN_CATALOG)
        .filter((p) => p.purchasable)
        .map((p) => ({ key: p.key, name: p.name, features: [...p.features] }))
    : []

  // Credit balance visibility (CRB-01..04): resolved independently of
  // isBillingEnforced() so the indicator is visible today even with
  // enforcement off — see CONTEXT.md Visibility Gating decision.
  let copilotBalance: { includedUsd: number; topupUsd: number; totalUsd: number; includedAllowanceUsd: number } | null = null
  let hasCreditsPlan = false
  // Platform (system) admins aren't metered, so the credit indicator is
  // meaningless for them — skip it entirely (keeps hasCreditsPlan false).
  if (activeOrgId && !rbacContext.isPlatformAdmin) {
    try {
      const visibility = await resolveCreditsVisibility(activeOrgId)
      copilotBalance = {
        includedUsd: visibility.balance.includedUsd,
        topupUsd: visibility.balance.topupUsd,
        totalUsd: visibility.balance.totalUsd,
        includedAllowanceUsd: visibility.balance.includedAllowanceUsd,
      }
      hasCreditsPlan = visibility.hasCreditsPlan
    } catch (err) {
      console.error('[billing] resolveCreditsVisibility failed in dashboard layout:', err)
      copilotBalance = null
      hasCreditsPlan = false
    }
  }

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
  // Server-computed seed for the sidebar's unread-chat badge — fails open to 0
  // (matches /api/chat/unread-count's own fail-open behavior).
  let initialUnreadCount = 0
  try {
    const supabase = await createClient()
    const [{ data: settings }, { count: numberCount }, chainResult, { data: unreadCountRaw }] = await Promise.all([
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
      activeOrgId
        ? supabase
            .from('call_routing_chains')
            .select('is_active, stages')
            .eq('org_id', activeOrgId)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      supabase.rpc('inbox_unread_count'),
    ])
    const chain = chainResult.data
    initialUnreadCount = typeof unreadCountRaw === 'number' ? unreadCountRaw : 0
    // Mount the Voice SDK Device for users who are EITHER on legacy
    // routing_mode='browser' OR a browser/pwa target in the org's active routing
    // chain — both need a live Device to receive the <Client> leg. A client
    // identity is required to mint the token, so gate on it either way.
    let isChainVoiceTarget = false
    if (chain?.is_active && Array.isArray(chain.stages)) {
      isChainVoiceTarget = chain.stages.some(
        (s) =>
          !!s &&
          Array.isArray(s.targets) &&
          s.targets.some(
            (t) =>
              t.type === 'team' ||
              ((t.type === 'browser' || t.type === 'pwa') && t.user_id === user.id),
          ),
      )
    }
    browserVoiceEnabled =
      Boolean(settings?.twilio_client_identity) &&
      (settings?.routing_mode === 'browser' || isChainVoiceTarget)
    hasPhoneNumber = (numberCount ?? 0) > 0
  } catch {
    browserVoiceEnabled = false
    hasPhoneNumber = false
    initialUnreadCount = 0
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
  // Reuses the org id already resolved by getActiveOrg() above instead of
  // re-invoking get_current_org_id().
  const orgSettings = await getOrgSettings(activeOrgId)

  // Preload the org-switcher dropdown list server-side so it opens instantly
  // instead of lazy-fetching on first click.
  const initialOrgs = await getUserOrgs()

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
                  entitledFeatures={entitledFeatures}
                  initialUnreadCount={initialUnreadCount}
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
                      hasCreditsPlan={hasCreditsPlan}
                      copilotBalance={copilotBalance}
                      initialOrgs={initialOrgs}
                    />
                    <div className="flex-1 min-h-0">
                      <PageTransition>
                        {billingBlocked ? (
                          <BillingPaywall
                            plans={paywallPlans}
                            trialEnded={entitlements?.status === 'expired'}
                            isAdmin={isOrgAdmin}
                          />
                        ) : (
                          children
                        )}
                      </PageTransition>
                    </div>
                  </main>
                  {copilotEnabled && <CopilotPanel hasProvider={hasCopilotProvider} />}
                </div>
              </div>
              <OnboardingTour />
              <Suspense fallback={null}>
                <InviteResultToast />
              </Suspense>
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
