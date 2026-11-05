import 'server-only'
import { createServiceRoleClient } from '@/lib/supabase/admin'

export interface IdentityBinding {
  projectId: string
  uid: string
}

export async function userIdForGoogleIdentity(identity: IdentityBinding): Promise<string | null> {
  const { data, error } = await createServiceRoleClient()
    .from('auth_google_identities')
    .select('user_id')
    .eq('project_id', identity.projectId)
    .eq('subject', identity.uid)
    .maybeSingle()
  if (error) throw new Error(`userIdForGoogleIdentity failed: ${error.message}`)
  return data?.user_id ?? null
}

/**
 * Call only after proof of ownership of the app account (verified phone).
 *
 * supabase-js has no transactions, so instead of Xpot's advisory lock this
 * inserts with ON CONFLICT DO NOTHING and reads back: whichever concurrent
 * request wins the primary key owns the identity, and a loser sees the
 * winner's user_id and throws.
 */
export async function bindGoogleIdentities(identities: IdentityBinding[], userId: string): Promise<void> {
  const unique = Array.from(new Map(identities.map((i) => [`${i.projectId}/${i.uid}`, i])).values())
  if (unique.length === 0) return
  const admin = createServiceRoleClient()

  const { error: insertError } = await admin
    .from('auth_google_identities')
    .upsert(
      unique.map((i) => ({ project_id: i.projectId, subject: i.uid, user_id: userId })),
      { onConflict: 'project_id,subject', ignoreDuplicates: true },
    )
  if (insertError) throw new Error(`bindGoogleIdentities failed: ${insertError.message}`)

  for (const identity of unique) {
    const { data, error } = await admin
      .from('auth_google_identities')
      .select('user_id')
      .eq('project_id', identity.projectId)
      .eq('subject', identity.uid)
      .maybeSingle()
    if (error) throw new Error(`bindGoogleIdentities failed: ${error.message}`)
    if (data && data.user_id !== userId) throw new Error('Identity is already linked to another account')
  }
}
