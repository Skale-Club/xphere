'use client'

import { CampaignsPanelProvider } from './ads-campaigns-context'
import { CampaignsPanel } from './campaigns-panel'

/**
 * Client wrapper for the Ads layout.
 * Provides the campaigns panel context to all child pages and renders the
 * side panel alongside the content — same push-left pattern as CopilotPanel.
 */
export function AdsShell({ children }: { children: React.ReactNode }) {
  return (
    <CampaignsPanelProvider>
      <div className="flex h-full min-h-0 overflow-hidden">
        <div className="flex-1 min-w-0 overflow-auto">
          {children}
        </div>
        <CampaignsPanel />
      </div>
    </CampaignsPanelProvider>
  )
}
