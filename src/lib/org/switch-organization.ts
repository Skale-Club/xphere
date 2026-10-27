/**
 * Switch through the JSON route, never a Server Action: changing cookies and
 * revalidating a layout in an action renders the OLD page before the caller
 * can navigate. That render can fail even after the org was saved successfully.
 * Callers perform a full navigation to an org-pinned URL only after success.
 */
export async function switchOrganization(orgId: string): Promise<{ error?: string }> {
  const fallback = 'Could not switch organization. Please try again.'
  try {
    const response = await fetch('/api/org/default', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ orgId }),
    })
    const result = await response.json()
    if (!response.ok || result?.ok !== true) {
      return { error: typeof result?.error === 'string' && result.error ? result.error : fallback }
    }
    return {}
  } catch {
    // Network/response failures must stay in the current screen, not escape a
    // React transition into the app-wide error boundary.
    return { error: fallback }
  }
}
