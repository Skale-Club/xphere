// VAPID public key — safe to be public, used by the browser to subscribe.
// Set NEXT_PUBLIC_VAPID_PUBLIC_KEY in your environment to override.
// The matching private key must be set as VAPID_PRIVATE_KEY in the
// Supabase push-sender edge function secrets.
export const VAPID_PUBLIC_KEY =
  process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ??
  'BMEcSTxVVttfJ9u9yWgHDgO_BQOTKoh4tvGIM8QlzrhjDSThw3xAitj6l6SySKlEPdiag7BCORb_VZ_Hi6BwNY0'
