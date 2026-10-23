#!/usr/bin/env node
// Provisions a game tenant the same way the dashboard does (organizations/actions.ts createOrganization,
// analytics/actions.ts getOrCreateAnalyticsSetup + saveAnalyticsSetup), from the CLI.
// Idempotent: an existing org (by slug), membership or setup is reused, never duplicated.
// API keys are not minted here: the owner creates them in Settings > API keys so the secret never leaves the UI.
//
// Usage:
//   npx tsx --env-file=.env.local scripts/provision-game-org.ts --name "Brasil Showdown" \
//     --owner-email you@example.com --owner-from-org <uuid> --url https://brasilshowdown.com --gtm GTM-XXXX          # dry run
//   ... --apply                                                                              # write
//   ... --logo path/to/icon.png   sets the org avatar like settings/workspace uploadOrgLogo (256x256 webp, `avatars` bucket)
//   ... --meta-pixel <dataset id> --currency BRL   turns on the browser Pixel + CAPI like ads/capi saveCapiConfig, with only the
//       `lead` event (contact created); the CAPI token is left untouched for the owner to enter in /ads/capi
//
// Env: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { seedOrgWorkflows } from '../src/lib/workflows/seed-org'

function arg(name: string): string | undefined {
  const i = process.argv.indexOf('--' + name)
  return i >= 0 ? process.argv[i + 1] : undefined
}

function slugify(value: string): string {
  return value.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

async function main() {
  const apply = process.argv.includes('--apply')
  const name = arg('name')?.trim()
  const ownerEmail = arg('owner-email')?.trim().toLowerCase()
  const url = arg('url')?.trim() || null
  const gtm = arg('gtm')?.trim() || null
  if (!name || !ownerEmail) throw new Error('Required: --name --owner-email')

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } }) as any
  const slug = slugify(name)
  const plan: string[] = []

  // The owner is the single owner of a reference org they already own (auth admin listUsers is not reliable here),
  // confirmed against the given email.
  const fromOrg = arg('owner-from-org')
  if (!fromOrg) throw new Error('Required: --owner-from-org <org id the owner already owns>')
  const { data: owners, error: ownersError } = await admin.from('org_members').select('user_id').eq('organization_id', fromOrg).eq('role', 'owner')
  if (ownersError) throw ownersError
  if (!owners || owners.length !== 1) throw new Error(`Expected one owner in the reference org, found ${owners?.length ?? 0}`)
  const ownerId: string = owners[0].user_id
  const { data: ownerUser, error: ownerError } = await admin.auth.admin.getUserById(ownerId)
  if (ownerError) throw ownerError
  if (ownerUser.user?.email?.toLowerCase() !== ownerEmail) throw new Error('Reference org owner does not match --owner-email')

  let { data: org } = await admin.from('organizations').select('id, name').eq('slug', slug).maybeSingle()
  if (org) plan.push(`org exists: ${org.id}`)
  else {
    plan.push(`create org "${name}" (${slug})`)
    if (apply) {
      const created = await admin.from('organizations').insert({ name, slug, widget_token: crypto.randomUUID() }).select('id, name').single()
      if (created.error) throw created.error
      org = created.data
      await seedOrgWorkflows(org.id).catch((e: unknown) => console.warn('workflow seed failed:', (e as Error).message))
    }
  }

  if (org) {
    const { data: member } = await admin.from('org_members').select('role').eq('organization_id', org.id).eq('user_id', ownerId).maybeSingle()
    if (member) plan.push(`owner membership exists (${member.role})`)
    else {
      plan.push('add owner membership')
      if (apply) {
        const res = await admin.from('org_members').insert({ organization_id: org.id, user_id: ownerId, role: 'owner' })
        if (res.error) throw res.error
      }
    }

    let { data: setup } = await admin.from('analytics_setups').select('id, script_token, primary_website_url, gtm_container_id').eq('organization_id', org.id).maybeSingle()
    if (!setup) {
      plan.push('create analytics setup')
      if (apply) {
        const res = await admin.from('analytics_setups').insert({ organization_id: org.id }).select('id, script_token, primary_website_url, gtm_container_id').single()
        if (res.error) throw res.error
        setup = res.data
      }
    }
    if (setup && (setup.primary_website_url !== url || setup.gtm_container_id !== gtm)) {
      plan.push(`set analytics url=${url} gtm=${gtm}`)
      if (apply) {
        const res = await admin.from('analytics_setups').update({ primary_website_url: url, gtm_container_id: gtm }).eq('id', setup.id)
        if (res.error) throw res.error
      }
    }
    if (setup) plan.push(`analytics script token (public, goes in the page tag): ${setup.script_token}`)

    const logo = arg('logo')
    if (logo) {
      plan.push(`set org avatar from ${logo}`)
      if (apply) {
        const sharp = (await import('sharp')).default
        const processed = await sharp(readFileSync(logo)).rotate().resize(256, 256, { fit: 'cover', position: 'attention' }).webp({ quality: 86 }).toBuffer()
        const objectPath = `${org.id}/logo/${Math.random().toString(36).slice(2, 10)}.webp`
        const up = await admin.storage.from('avatars').upload(objectPath, processed, { contentType: 'image/webp', upsert: false, cacheControl: '3600' })
        if (up.error) throw up.error
        const publicUrl: string = admin.storage.from('avatars').getPublicUrl(objectPath).data.publicUrl
        const res = await admin.from('organizations').update({ logo_url: publicUrl }).eq('id', org.id)
        if (res.error) throw res.error
        plan.push(`org avatar: ${publicUrl}`)
      }
    }
    const metaPixel = arg('meta-pixel')?.trim()
    if (metaPixel) {
      if (!/^\d{6,20}$/.test(metaPixel)) throw new Error('--meta-pixel must be the numeric dataset id')
      const currency = (arg('currency') ?? 'USD').trim().toUpperCase()
      const row = {
        org_id: org.id, dataset_id: metaPixel, pixel_id: metaPixel, enabled: true, browser_pixel_enabled: true,
        default_currency: currency,
        event_map: { lead: { enabled: true }, qualified: { enabled: false, stage_name: 'Qualified' }, purchase: { enabled: false, value_source: 'opportunity_value' } },
      }
      plan.push(`meta pixel ${metaPixel}: browser pixel on, CAPI on (lead only), currency ${currency}`)
      if (apply) {
        const res = await admin.from('meta_capi_config').upsert(row, { onConflict: 'org_id' })
        if (res.error) throw res.error
      }
    }
    plan.push(`org id: ${org.id}`)
  }

  console.log((apply ? 'APPLIED' : 'DRY RUN') + '\n- ' + plan.join('\n- '))
}

main().catch(error => { console.error('provision failed:', error?.message ?? error); process.exit(1) })
