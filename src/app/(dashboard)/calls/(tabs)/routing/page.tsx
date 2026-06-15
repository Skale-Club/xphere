import { AlertCircle } from 'lucide-react'

import { getRoutingChain } from '@/app/(dashboard)/settings/calls/actions'
import { listOrgMembersForSelect } from '@/app/(dashboard)/integrations/twilio/numbers-actions'
import { RoutingChainEditor } from '@/components/calls/routing-chain-editor'

export const metadata = { title: 'Call Routing' }

export default async function CallsRoutingPage() {
  const [chain, members] = await Promise.all([
    getRoutingChain(),
    listOrgMembersForSelect(),
  ])

  return (
    <div className="pt-2 pb-8">
      <div className="mb-5 rounded-[12px] border border-amber-400/25 bg-amber-400/[0.06] px-4 py-3">
        <div className="flex gap-3">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
          <div>
            <p className="text-[13px] font-medium text-text-primary">Routing priority</p>
            <p className="mt-1 text-[12.5px] leading-relaxed text-text-secondary">
              When global call routing is active, it takes priority over each phone
              number's default routing mode. Turn it off to let individual numbers
              use their own browser, SIP, or forwarding behavior.
            </p>
          </div>
        </div>
      </div>
      <RoutingChainEditor initial={chain} members={members} />
    </div>
  )
}
