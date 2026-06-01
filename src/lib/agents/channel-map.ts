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
      return channel
    // Zernio per-platform channels map to their underlying agent channel.
    case 'zernio_instagram':
      return 'instagram'
    case 'zernio_facebook':
      return 'messenger'
    case 'zernio_whatsapp':
      return 'whatsapp'
    case 'zernio_telegram':
      return 'telegram'
    default:
      return null
  }
}
