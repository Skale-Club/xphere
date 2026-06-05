'use client'

import { createContext, useContext, useState, useCallback } from 'react'

interface CampaignsPanelState {
  open: boolean
  adAccountId: string
  currency: string
  dateQuery: string
  platform: 'meta' | 'google'
}

interface CampaignsPanelContext extends CampaignsPanelState {
  openPanel: (params: Omit<CampaignsPanelState, 'open'>) => void
  closePanel: () => void
}

const CampaignsPanelCtx = createContext<CampaignsPanelContext | null>(null)

export function CampaignsPanelProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<CampaignsPanelState>({
    open: false,
    adAccountId: '',
    currency: 'USD',
    dateQuery: '',
    platform: 'meta',
  })

  const openPanel = useCallback((params: Omit<CampaignsPanelState, 'open'>) => {
    setState({ open: true, ...params })
  }, [])

  const closePanel = useCallback(() => {
    setState((s) => ({ ...s, open: false }))
  }, [])

  return (
    <CampaignsPanelCtx.Provider value={{ ...state, openPanel, closePanel }}>
      {children}
    </CampaignsPanelCtx.Provider>
  )
}

export function useCampaignsPanel() {
  const ctx = useContext(CampaignsPanelCtx)
  if (!ctx) throw new Error('useCampaignsPanel must be used inside CampaignsPanelProvider')
  return ctx
}
