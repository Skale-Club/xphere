'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { createClient } from '@/lib/supabase/server'

const HEX_RE = /^#[0-9a-fA-F]{6}$/

const updateSchema = z.object({
  logo_url: z
    .string()
    .trim()
    .max(2048, 'Logo URL is too long')
    .url('Logo URL must be a valid URL')
    .optional()
    .nullable()
    .or(z.literal('')),
  accent_color: z
    .string()
    .trim()
    .regex(HEX_RE, 'Accent must be a 6-digit hex like #6366F1')
    .optional()
    .nullable()
    .or(z.literal('')),
  brand_name: z
    .string()
    .trim()
    .max(64, 'Brand name is too long')
    .optional()
    .nullable()
    .or(z.literal('')),
})

export type UpdateWorkspaceBrandingInput = z.infer<typeof updateSchema>

export interface ActionResult {
  ok: boolean
  error?: string
}

/**
 * Update branding fields (logo_url, accent_color, brand_name) on the current
 * org. Empty strings are normalized to null. RLS enforces org membership.
 */
export async function updateWorkspaceBranding(input: UpdateWorkspaceBrandingInput): Promise<ActionResult> {
  const parsed = updateSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' }
  }

  const supabase = await createClient()
  const { data: orgId, error: orgErr } = await supabase.rpc('get_current_org_id')
  if (orgErr || !orgId) {
    return { ok: false, error: 'No active organization' }
  }

  const patch: Record<string, string | null> = {}
  if (parsed.data.logo_url !== undefined) {
    patch.logo_url = parsed.data.logo_url && parsed.data.logo_url.length > 0 ? parsed.data.logo_url : null
  }
  if (parsed.data.accent_color !== undefined) {
    patch.accent_color = parsed.data.accent_color && parsed.data.accent_color.length > 0 ? parsed.data.accent_color : null
  }
  if (parsed.data.brand_name !== undefined) {
    patch.brand_name = parsed.data.brand_name && parsed.data.brand_name.length > 0 ? parsed.data.brand_name : null
  }

  if (Object.keys(patch).length === 0) {
    return { ok: true }
  }

  const { error: updateErr } = await supabase
    .from('organizations')
    .update(patch)
    .eq('id', orgId as string)

  if (updateErr) {
    return { ok: false, error: updateErr.message }
  }

  // Branding feeds into the dashboard layout — revalidate all dashboard routes.
  revalidatePath('/', 'layout')
  return { ok: true }
}
