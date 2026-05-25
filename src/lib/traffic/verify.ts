export type VerificationResult =
  | 'verified'
  | 'script_not_found'
  | 'no_events_yet'
  | 'url_unreachable'
  | 'failed'

export async function verifyTrackingInstallation(
  websiteUrl: string,
  scriptToken: string,
): Promise<VerificationResult> {
  let normalized = websiteUrl.trim()
  if (!normalized.startsWith('http://') && !normalized.startsWith('https://')) {
    normalized = 'https://' + normalized
  }

  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 10000)

    const res = await fetch(normalized, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Xphere-Verifier/1.0' },
    }).finally(() => clearTimeout(timeout))

    if (!res.ok) return 'url_unreachable'

    const html = await res.text()
    if (html.includes(scriptToken)) return 'no_events_yet'

    return 'script_not_found'
  } catch {
    return 'url_unreachable'
  }
}
