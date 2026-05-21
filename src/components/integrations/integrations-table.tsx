'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronRight } from 'lucide-react'
import { StatusPill } from '@/components/design-system/status-pill'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import { IntegrationForm } from './integration-form'
import type { IntegrationForDisplay } from '@/app/(dashboard)/integrations/actions'

type Provider = IntegrationForDisplay['provider']

// Routing rule for /integrations:
//   - Single-credential providers (one key + optional config) live here as
//     inline Sheets | quick to edit, no navigation.
//   - Providers with multi-resource setup (numbers, instances, pages, embeds)
//     have dedicated pages under /integrations/[provider] and appear ONLY in
//     the "Channels & dedicated" grid on the index page.
//
// Twilio is a dedicated integration (multi-number support since v2.3) and is
// intentionally NOT in this list.
const ALL_PROVIDERS: { id: Provider; label: string; description: string }[] = [
  { id: 'vapi', label: 'Vapi', description: 'AI voice assistant platform' },
  { id: 'gohighlevel', label: 'GoHighLevel', description: 'CRM and marketing automation' },
  { id: 'calcom', label: 'Cal.com', description: 'Scheduling and calendar management' },
  { id: 'openai', label: 'OpenAI', description: 'GPT models and embeddings' },
  { id: 'anthropic', label: 'Anthropic', description: 'Claude AI models' },
  { id: 'openrouter', label: 'OpenRouter', description: 'Multi-model AI gateway' },
]

interface IntegrationsTableProps {
  integrations: IntegrationForDisplay[]
}

export function IntegrationsTable({ integrations }: IntegrationsTableProps) {
  const router = useRouter()
  const [selectedProvider, setSelectedProvider] = useState<Provider | null>(null)
  const [isSheetOpen, setIsSheetOpen] = useState(false)

  const connectedMap = new Map(integrations.map((i) => [i.provider, i]))

  function openSheet(provider: Provider) {
    setSelectedProvider(provider)
    setIsSheetOpen(true)
  }

  function handleSheetClose() {
    setIsSheetOpen(false)
    setSelectedProvider(null)
  }

  function handleSuccess() {
    handleSheetClose()
    router.refresh()
  }

  const selectedIntegration = selectedProvider ? connectedMap.get(selectedProvider) : undefined

  return (
    <>
      <div className="overflow-hidden rounded-[12px] border border-border bg-bg-secondary divide-y divide-border-subtle">
        {ALL_PROVIDERS.map(({ id, label, description }) => {
          const integration = connectedMap.get(id)
          const isConnected = !!integration

          return (
            <button
              key={id}
              onClick={() => openSheet(id)}
              className="group flex w-full items-center justify-between gap-4 px-5 py-4 text-left transition-colors hover:bg-bg-tertiary/50 focus-visible:outline-none focus-visible:bg-bg-tertiary/50"
            >
              <div className="min-w-0">
                <p className="text-[13.5px] font-medium text-text-primary">{label}</p>
                <p className="mt-0.5 text-[12px] text-text-tertiary">{description}</p>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                {isConnected && (
                  <span className="hidden font-mono text-[11px] text-text-tertiary sm:inline">
                    {integration.masked_api_key}
                  </span>
                )}
                <StatusPill tone={isConnected ? 'success' : 'idle'}>
                  {isConnected ? 'Connected' : 'Not connected'}
                </StatusPill>
                <ChevronRight className="h-4 w-4 -translate-x-0.5 text-text-tertiary opacity-0 transition-all duration-200 group-hover:translate-x-0 group-hover:opacity-100" />
              </div>
            </button>
          )
        })}
      </div>

      <Sheet
        open={isSheetOpen}
        onOpenChange={(open) => { if (!open) handleSheetClose() }}
      >
        <SheetContent side="right" className="p-0 sm:max-w-lg">
          {selectedProvider && (
            <IntegrationForm
              provider={selectedProvider}
              integration={selectedIntegration}
              onSuccess={handleSuccess}
            />
          )}
        </SheetContent>
      </Sheet>
    </>
  )
}
