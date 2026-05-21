// src/lib/ghl/send-sms.ts
// Executor for the send_sms action type when the bound integration is GoHighLevel.
// Sends SMS via the GHL Conversations API instead of Twilio | the message lives
// inside the sub-account's conversation history, and replies route back through
// the GHL inbound webhook just like any other CRM-originated SMS.
//
// GHL requires a contactId on /conversations/messages | there is no "send to a
// raw phone number" endpoint. If the caller (LLM/webhook) passes contactId we
// use it directly; otherwise we resolve contactId from a phone number with a
// find-or-create flow (1-2 extra API calls).
//
// Result strings never contain newlines | Vapi's response parser breaks on \n.

import { ghlFetchJson, type GhlCredentials } from './client'

// SMS flow may need 2-3 sequential GHL calls (find + create + send).
// The hot-path default of 400ms is far too tight, so each call gets its own
// budget here. The Vapi tool route still owns the wall-clock limit upstream.
const SMS_TIMEOUT_MS = 2500

interface GhlContact {
  id: string
  phone?: string | null
}

interface ContactListResponse {
  contacts?: GhlContact[]
}

interface CreateContactResponse {
  contact: GhlContact
}

interface SendMessageResponse {
  messageId?: string
  conversationId?: string
  msg?: string
}

export async function sendSmsViaGhl(
  params: Record<string, unknown>,
  credentials: GhlCredentials
): Promise<string> {
  const explicitContactId =
    typeof params.contactId === 'string' && params.contactId.trim()
      ? params.contactId.trim()
      : null
  const to = String(params.to ?? params.phone ?? '').trim()
  const message = String(params.body ?? params.message ?? '').trim()
  const fromNumber =
    typeof params.fromNumber === 'string' && params.fromNumber.trim()
      ? params.fromNumber.trim()
      : null

  if (!message) {
    throw new Error('send_sms requires a "body" message parameter.')
  }
  if (!explicitContactId && !to) {
    throw new Error('send_sms requires either a "contactId" or a "to" phone number parameter.')
  }

  let contactId = explicitContactId
  if (!contactId) {
    const listed = await ghlFetchJson<ContactListResponse>(
      '/contacts/',
      'GET',
      null,
      credentials,
      { locationId: credentials.locationId, query: to, limit: '1' },
      SMS_TIMEOUT_MS
    )

    if (listed.contacts && listed.contacts.length > 0 && listed.contacts[0].id) {
      contactId = listed.contacts[0].id
    } else {
      const created = await ghlFetchJson<CreateContactResponse>(
        '/contacts/',
        'POST',
        { locationId: credentials.locationId, phone: to },
        credentials,
        undefined,
        SMS_TIMEOUT_MS
      )
      contactId = created.contact.id
    }
  }

  const sent = await ghlFetchJson<SendMessageResponse>(
    '/conversations/messages',
    'POST',
    {
      type: 'SMS',
      contactId,
      message,
      ...(fromNumber ? { fromNumber } : {}),
    },
    credentials,
    undefined,
    SMS_TIMEOUT_MS
  )

  const id = sent.messageId ?? sent.conversationId ?? 'sent'
  return `SMS sent via GHL. ID: ${id}`
}
