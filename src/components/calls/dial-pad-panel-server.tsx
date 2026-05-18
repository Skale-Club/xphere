// Server component wrapper — reads call_settings for the current user and
// passes initial values down to the client DialPadPanel.

import { createClient, getUser } from '@/lib/supabase/server'
import { DialPadPanel } from './dial-pad-panel'

export async function DialPadPanelServer() {
  const user = await getUser()
  if (!user) return null

  const supabase = await createClient()
  const { data: settings } = await supabase
    .from('call_settings')
    .select('routing_mode, record_calls')
    .eq('user_id', user.id)
    .maybeSingle()

  return (
    <DialPadPanel
      initialRecordCalls={settings?.record_calls ?? true}
      routingMode={settings?.routing_mode ?? 'phone_forward'}
    />
  )
}
