import { createClient } from '@/lib/supabase/server'
import { AssistantMappingsTable } from '@/components/assistants/assistant-mappings-table'
import type { Database } from '@/types/database'

type AssistantMapping = Database['public']['Tables']['assistant_mappings']['Row']

export default async function CallsAssistantsPage() {
  const supabase = await createClient()
  const { data } = await supabase
    .from('assistant_mappings')
    .select('*')
    .order('created_at', { ascending: false })

  return <AssistantMappingsTable mappings={(data ?? []) as AssistantMapping[]} />
}
