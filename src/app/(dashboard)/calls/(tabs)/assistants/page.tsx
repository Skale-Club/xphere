import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { AssistantMappingsTable } from '@/components/assistants/assistant-mappings-table'
import type { Database } from '@/types/database'
import { Button } from '@/components/ui/button'
import { Plug } from 'lucide-react'

type AssistantMapping = Database['public']['Tables']['assistant_mappings']['Row']

export default async function CallsAssistantsPage() {
  const supabase = await createClient()

  // Gate: only show the mapping UI when Vapi integration is active
  const { data: vapiIntegration } = await supabase
    .from('integrations')
    .select('id')
    .eq('provider', 'vapi')
    .eq('is_active', true)
    .maybeSingle()

  if (!vapiIntegration) {
    return (
      <div className="-mt-6 flex min-h-[240px] flex-col items-center justify-center rounded-[8px] border border-dashed border-border bg-bg-secondary/30 px-4 py-16 text-center">
        <Plug className="h-10 w-10 text-muted-foreground mb-4" />
        <h3 className="text-base font-semibold mb-1">Vapi integration required</h3>
        <p className="text-sm text-muted-foreground mb-4 max-w-sm">
          Connect your Vapi account to link voice assistants and route call webhooks to this workspace.
        </p>
        <Button asChild>
          <Link href="/integrations">Go to Integrations</Link>
        </Button>
      </div>
    )
  }

  const { data } = await supabase
    .from('assistant_mappings')
    .select('*')
    .order('created_at', { ascending: false })

  return <AssistantMappingsTable mappings={(data ?? []) as AssistantMapping[]} />
}
