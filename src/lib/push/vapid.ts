// VAPID public key — safe to be public, used by the browser to subscribe.
// Sourced exclusively from NEXT_PUBLIC_VAPID_PUBLIC_KEY (a Coolify build var,
// inlined at build time). The matching private key lives only as the
// VAPID_PRIVATE_KEY secret on the Supabase push-sender edge function — never
// committed to the repo.
export const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? ''
