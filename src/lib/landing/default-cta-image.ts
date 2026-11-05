// The landing page's fallback call-to-action image. Pure constant (no server
// imports) so the client landing page and the server config reader share it.
// Override with NEXT_PUBLIC_LANDING_CTA_IMAGE_URL (inlined at build time) once
// the branding bucket has moved; the default is the Supabase public URL.
export const DEFAULT_CTA_IMAGE_URL =
  process.env.NEXT_PUBLIC_LANDING_CTA_IMAGE_URL ||
  'https://media.xphere.app/branding/landing/cta-bg.webp'
