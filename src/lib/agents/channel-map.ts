import type { AgentChannel } from '@/types/database'

export function conversationChannelToAgentChannel(channel: string | null | undefined): AgentChannel | null {
  switch (channel) {
    case 'widget':
    case 'web':
    case 'web_widget':
      return 'web_widget'
    case 'sms':
    case 'ghl_sms':
      return 'sms'
    case 'whatsapp':
    case 'ghl_whatsapp':
      return 'whatsapp'
    case 'messenger':
    case 'instagram':
    case 'manychat':
    case 'telegram':
    case 'zernio':
      return channel
    default:
      return null
  }
}
