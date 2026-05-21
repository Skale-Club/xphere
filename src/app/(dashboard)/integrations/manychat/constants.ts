// Shared constants for the ManyChat integration | importable from both server and client code.
// This file must NOT have 'use server' or 'use client' directives.

export type ManychatChannelForDisplay = {
  id: string
  channelName: string
  keyHint: string
  webhookSecret: string
  isActive: boolean
  createdAt: string
}

export const MANYCHAT_PAYLOAD_TEMPLATE = {
  subscriber_id: '{{user.id}}',
  first_name: '{{user.first_name}}',
  last_name: '{{user.last_name}}',
  email: '{{user.email}}',
  phone: '{{user.phone}}',
  tags: '{{user.tags}}',
  event_type: 'flow_completed',
  flow_id: '{{flow_id}}',
} as const
