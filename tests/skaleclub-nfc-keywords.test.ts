// The skaleclub NFC pages' WhatsApp button pre-fills one message per language.
// Each must wake the NFC agent through the real matcher, with a keyword in its
// own language, or visitors tapping the button get no reply.

import { describe, it, expect } from 'vitest'
import { matchActivationKeyword } from '@/lib/agent-runtime/conversation-routing'
import {
  NFC_ACTIVATION_KEYWORDS,
  SKALECLUB_WHATSAPP_BUTTON_MESSAGES,
} from '../scripts/skaleclub-nfc-agent/keywords'

describe('Skale Club NFC WhatsApp button → agent activation', () => {
  it('the English page message activates the agent', () => {
    expect(matchActivationKeyword(SKALECLUB_WHATSAPP_BUTTON_MESSAGES.en, NFC_ACTIVATION_KEYWORDS)).toBe(
      'keychains',
    )
  })

  it('the Portuguese page message activates the agent', () => {
    expect(matchActivationKeyword(SKALECLUB_WHATSAPP_BUTTON_MESSAGES.pt, NFC_ACTIVATION_KEYWORDS)).toBe(
      'chaveiros',
    )
  })

  it('common ways people write it by hand also activate it', () => {
    for (const text of [
      'Quanto custa o chaveiro?',
      'vocês fazem chaveirinho com logo?',
      'Do you sell NFC key chains?',
      'Hacen llaveros NFC?',
    ]) {
      expect(matchActivationKeyword(text, NFC_ACTIVATION_KEYWORDS), text).not.toBeNull()
    }
  })
})
