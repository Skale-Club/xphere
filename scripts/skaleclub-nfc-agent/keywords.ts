// Activation keywords for the Skale Club "Chaveiros NFC" agent.
//
// Mirrored in the skaleclub repo as NFC_AGENT_KEYWORDS (shared/nfc-whatsapp.ts),
// whose "Talk to us on WhatsApp" button pre-fills a message per page language
// that must contain one of these — EN "…the NFC keychains." / PT "…os chaveiros
// NFC." (tests/skaleclub-nfc-keywords.test.ts). Change both lists together.
export const NFC_ACTIVATION_KEYWORDS = [
  'chaveiro',
  'chaveiros',
  'chaveirinho',
  'chaveirinhos',
  'keychain',
  'keychains',
  'key chain',
  'key chains',
  'keyring',
  'keyrings',
  'llavero',
  'llaveros',
  'nfc',
]

/** The pre-filled messages of the skaleclub WhatsApp button, per page language. */
export const SKALECLUB_WHATSAPP_BUTTON_MESSAGES = {
  en: "Hi! I'd like to know more about the NFC keychains.",
  pt: 'Oi! Quero saber mais sobre os chaveiros NFC.',
} as const
