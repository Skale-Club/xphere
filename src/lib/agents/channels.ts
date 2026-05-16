/**
 * Mirrors the public.agent_channel enum (migration 034).
 */
export const AGENT_CHANNELS = [
  'web_widget',
  'whatsapp',
  'messenger',
  'instagram',
  'manychat',
  'telegram',
] as const

export type AgentChannel = (typeof AGENT_CHANNELS)[number]

export const AGENT_CHANNEL_LABELS: Record<AgentChannel, string> = {
  web_widget: 'Web Widget',
  whatsapp: 'WhatsApp',
  messenger: 'Messenger',
  instagram: 'Instagram',
  manychat: 'ManyChat',
  telegram: 'Telegram',
}
