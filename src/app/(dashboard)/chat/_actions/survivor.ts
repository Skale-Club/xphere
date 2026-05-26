'use server'

import { createClient } from '@/lib/supabase/server'

/**
 * Look up the display name of a merge survivor. Used by MergedBanner via
 * useEffect in contact-info-panel (which is a client component and cannot
 * fetch directly).
 *
 * Preference order for display:
 *   1. contacts.name
 *   2. first_name + ' ' + last_name (whichever halves are present)
 *   3. email
 *   4. null (caller renders "survivor" fallback)
 *
 * Returns null on any error or not-found — caller falls back gracefully.
 */
export async function getSurvivorDisplayName(survivorId: string): Promise<string | null> {
  if (!survivorId) return null
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('contacts')
    .select('id, name, first_name, last_name, email')
    .eq('id', survivorId)
    .single()
  if (error || !data) return null

  if (data.name && data.name.trim()) return data.name.trim()
  const composed = [data.first_name, data.last_name].filter(Boolean).join(' ').trim()
  if (composed) return composed
  if (data.email && data.email.trim()) return data.email.trim()
  return null
}
