'use server'

import { createClient, getUser } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'

// ── helpers ──────────────────────────────────────────────────────────────────

async function requireAdmin() {
  const user = await getUser()
  if (!user) return { error: 'Not authenticated', user: null, orgId: null }

  const supabase = await createClient()
  const { data: orgId } = await supabase.rpc('get_current_org_id')
  if (!orgId) return { error: 'No active organization', user: null, orgId: null }

  const { data: membership } = await supabase
    .from('org_members')
    .select('role')
    .eq('user_id', user.id)
    .eq('organization_id', orgId as string)
    .single()

  if (membership?.role !== 'admin') {
    return { error: 'Admin access required', user: null, orgId: null }
  }

  return { error: null, user, orgId: orgId as string }
}

// ── listMembers ───────────────────────────────────────────────────────────────

export async function listMembers() {
  const { error, orgId } = await requireAdmin()
  if (error || !orgId) return { members: [], error }

  const supabase = await createClient()
  const { data, error: dbError } = await supabase
    .from('org_members')
    .select('id, user_id, role, created_at')
    .eq('organization_id', orgId)
    .order('created_at', { ascending: true })

  if (dbError) return { members: [], error: dbError.message }
  return { members: data ?? [], error: null }
}

// ── listInvites ───────────────────────────────────────────────────────────────

export async function listInvites() {
  const { error, orgId } = await requireAdmin()
  if (error || !orgId) return { invites: [], error }

  const supabase = await createClient()
  const { data, error: dbError } = await supabase
    .from('org_invites')
    .select('id, email, role, invited_at, accepted_at')
    .eq('org_id', orgId)
    .order('invited_at', { ascending: false })

  if (dbError) return { invites: [], error: dbError.message }
  return { invites: data ?? [], error: null }
}

// ── inviteMember ──────────────────────────────────────────────────────────────

const inviteSchema = z.object({
  email: z.string().email(),
  role: z.enum(['admin', 'member']),
})

export async function inviteMember(formData: FormData) {
  const { error, user, orgId } = await requireAdmin()
  if (error || !user || !orgId) return { error }

  const parsed = inviteSchema.safeParse({
    email: formData.get('email'),
    role: formData.get('role'),
  })
  if (!parsed.success) return { error: 'Invalid email or role' }

  const normalizedEmail = parsed.data.email.toLowerCase().trim()

  const supabase = await createClient()
  const { error: dbError } = await supabase.from('org_invites').insert({
    org_id: orgId,
    email: normalizedEmail,
    role: parsed.data.role,
    invited_by: user.id,
  })

  if (dbError) {
    if (dbError.code === '23505') return { error: 'This email is already invited to this organization.' }
    return { error: dbError.message }
  }

  revalidatePath('/members')
  return { error: null }
}

// ── revokeInvite ──────────────────────────────────────────────────────────────

export async function revokeInvite(inviteId: string) {
  const { error, orgId } = await requireAdmin()
  if (error || !orgId) return { error }

  const supabase = await createClient()
  const { error: dbError } = await supabase
    .from('org_invites')
    .delete()
    .eq('id', inviteId)
    .eq('org_id', orgId) // safety: ensures we only delete our own org's invites

  if (dbError) return { error: dbError.message }

  revalidatePath('/members')
  return { error: null }
}

// ── removeMember ──────────────────────────────────────────────────────────────

export async function removeMember(memberId: string) {
  const { error, user, orgId } = await requireAdmin()
  if (error || !user || !orgId) return { error }

  const supabase = await createClient()

  // Prevent admin from removing themselves
  const { data: targetMember } = await supabase
    .from('org_members')
    .select('user_id')
    .eq('id', memberId)
    .eq('organization_id', orgId)
    .single()

  if (targetMember?.user_id === user.id) {
    return { error: 'You cannot remove yourself from the organization.' }
  }

  const { error: dbError } = await supabase
    .from('org_members')
    .delete()
    .eq('id', memberId)
    .eq('organization_id', orgId) // safety

  if (dbError) return { error: dbError.message }

  revalidatePath('/members')
  return { error: null }
}
