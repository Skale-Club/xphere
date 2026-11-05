// src/lib/edge-functions/trusted-download-url.ts
// Signed downloads only ever come from R2. Without this check a worker would
// fetch any URL a caller put in the payload (SSRF). Same rule as the Deno
// functions in supabase/functions/*.

type Env = Record<string, string | undefined>

export function isTrustedDownloadUrl(raw: string, env: Env = process.env): boolean {
  try {
    const url = new URL(raw)
    if (url.protocol !== 'https:') return false
    if (url.hostname.endsWith('.r2.cloudflarestorage.com')) return true
    const custom = env.R2_ENDPOINT
    return !!custom && url.hostname === new URL(custom).hostname
  } catch {
    return false
  }
}
