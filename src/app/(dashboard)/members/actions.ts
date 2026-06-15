'use server'

import { createClient, getUser } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { sendPlatformEmail } from '@/lib/email/resend'
import { generateInviteToken } from '@/lib/invites/accept'

const APP_ORIGIN = process.env.NEXT_PUBLIC_APP_URL ?? 'https://xphere.app'

const PER_PAGE = 10

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

  // Owner ranks above admin — both may manage members (RBAC role hierarchy).
  if (membership?.role !== 'admin' && membership?.role !== 'owner') {
    return { error: 'Admin access required', user: null, orgId: null }
  }

  return { error: null, user, orgId: orgId as string }
}

// ── listMembers ───────────────────────────────────────────────────────────────

export type MemberProfile = {
  id: string
  user_id: string
  role: string
  joined_at: string
  email: string | null
  phone: string | null
  full_name: string | null
  avatar_url: string | null
  total_count: number
}

export async function listMembers(page = 1) {
  const { error, orgId } = await requireAdmin()
  if (error || !orgId) return { members: [], total: 0, error }

  const supabase = await createClient()
  const { data, error: dbError } = await supabase.rpc('get_org_member_profiles', {
    p_org_id: orgId,
    p_page: page,
    p_per_page: PER_PAGE,
  })

  if (dbError) return { members: [], total: 0, error: dbError.message }

  const rows = (data ?? []) as MemberProfile[]
  const total = rows[0]?.total_count ?? 0
  return { members: rows, total: Number(total), error: null }
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
  const token = generateInviteToken()

  const supabase = await createClient()
  const { error: dbError } = await supabase.from('org_invites').insert({
    org_id: orgId,
    email: normalizedEmail,
    role: parsed.data.role,
    invited_by: user.id,
    token,
  })

  if (dbError) {
    if (dbError.code === '23505') return { error: 'This email is already invited to this organization.' }
    return { error: dbError.message }
  }

  // Send invite email (fire-and-forget — never block the invite on email failure)
  const { data: org } = await supabase
    .from('organizations')
    .select('name')
    .eq('id', orgId)
    .single()

  const orgName = org?.name ?? 'your organization'
  const inviterName = user.user_metadata?.full_name ?? user.user_metadata?.name ?? user.email ?? 'A team member'
  const roleLabel = parsed.data.role === 'admin' ? 'Admin' : 'Member'

  const html = `
    <div style="font-family:Arial,Helvetica,sans-serif;max-width:600px;margin:0 auto;color:#111827;">
      <h2 style="font-size:22px;font-weight:700;margin-bottom:8px;">You've been invited to join ${escapeHtml(orgName)}</h2>
      <p style="font-size:15px;color:#374151;margin-bottom:24px;">
        ${escapeHtml(inviterName)} has invited you to join <strong>${escapeHtml(orgName)}</strong> on Xphere as <strong>${roleLabel}</strong>.
      </p>
      <a href="${APP_ORIGIN}/api/accept-invite?token=${token}" style="display:inline-block;background:#4f46e5;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-size:15px;font-weight:600;">
        Accept Invitation
      </a>
      <p style="font-size:13px;color:#6b7280;margin-top:32px;">
        Sign in with the Google account associated with <strong>${escapeHtml(normalizedEmail)}</strong>.<br/>
        If you weren't expecting this invitation, you can safely ignore this email.
      </p>
    </div>`

  sendPlatformEmail(
    normalizedEmail,
    `You've been invited to join ${orgName} on Xphere`,
    html,
  ).catch((err) => console.error('[inviteMember] email send failed:', err))

  revalidatePath('/members')
  revalidatePath('/settings/members')
  return { error: null }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// ── resendInvite ──────────────────────────────────────────────────────────────

export async function resendInvite(inviteId: string) {
  const { error, orgId } = await requireAdmin()
  if (error || !orgId) return { error }

  const supabase = await createClient()
  const { data: invite, error: dbError } = await supabase
    .from('org_invites')
    .select('id, email, role, token')
    .eq('id', inviteId)
    .eq('org_id', orgId)
    .is('accepted_at', null)
    .single()

  if (dbError || !invite) return { error: 'Invite not found.' }

  const { data: org } = await supabase
    .from('organizations')
    .select('name')
    .eq('id', orgId)
    .single()

  const orgName = org?.name ?? 'your organization'
  const roleLabel = invite.role === 'admin' ? 'Admin' : 'Member'

  const html = `
    <div style="font-family:Arial,Helvetica,sans-serif;max-width:600px;margin:0 auto;color:#111827;">
      <h2 style="font-size:22px;font-weight:700;margin-bottom:8px;">You've been invited to join ${escapeHtml(orgName)}</h2>
      <p style="font-size:15px;color:#374151;margin-bottom:24px;">
        You have a pending invitation to join <strong>${escapeHtml(orgName)}</strong> on Xphere as <strong>${roleLabel}</strong>.
      </p>
      <a href="${APP_ORIGIN}/api/accept-invite?token=${invite.token}" style="display:inline-block;background:#4f46e5;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-size:15px;font-weight:600;">
        Accept Invitation
      </a>
      <p style="font-size:13px;color:#6b7280;margin-top:32px;">
        Sign in with the Google account associated with <strong>${escapeHtml(invite.email)}</strong>.<br/>
        If you weren't expecting this invitation, you can safely ignore this email.
      </p>
    </div>`

  sendPlatformEmail(
    invite.email,
    `You've been invited to join ${orgName} on Xphere`,
    html,
  ).catch((err) => console.error('[resendInvite] email send failed:', err))

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
    .eq('org_id', orgId)

  if (dbError) return { error: dbError.message }

  revalidatePath('/members')
  revalidatePath('/settings/members')
  return { error: null }
}

// ── updateMemberRole ──────────────────────────────────────────────────────────

export async function updateMemberRole(memberId: string, role: 'admin' | 'member') {
  const { error, user, orgId } = await requireAdmin()
  if (error || !user || !orgId) return { error }

  const supabase = await createClient()

  const { data: targetMember } = await supabase
    .from('org_members')
    .select('user_id')
    .eq('id', memberId)
    .eq('organization_id', orgId)
    .single()

  if (targetMember?.user_id === user.id) {
    return { error: 'You cannot change your own role.' }
  }

  const { error: dbError } = await supabase
    .from('org_members')
    .update({ role })
    .eq('id', memberId)
    .eq('organization_id', orgId)

  if (dbError) return { error: dbError.message }

  revalidatePath('/members')
  revalidatePath('/settings/members')
  return { error: null }
}

// ── removeMember ──────────────────────────────────────────────────────────────

export async function removeMember(memberId: string) {
  const { error, user, orgId } = await requireAdmin()
  if (error || !user || !orgId) return { error }

  const supabase = await createClient()

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
    .eq('organization_id', orgId)

  if (dbError) return { error: dbError.message }

  revalidatePath('/members')
  revalidatePath('/settings/members')
  return { error: null }
}
