import { Suspense } from 'react'
import { getSeoConfig } from '../_actions/seo-config'
import { SeoConfigForm } from '@/components/admin/seo-config-form'
import { SeoPreviewCard } from '@/components/admin/seo-preview-card'

export default async function AdminSeoPage() {
  let config
  try {
    config = await getSeoConfig()
  } catch {
    return (
      <div className="p-6">
        <p className="text-sm text-text-secondary">
          Failed to load SEO config. Run the migration (070_seo_config.sql) and refresh.
        </p>
      </div>
    )
  }

  return (
    <div className="p-4 sm:p-6">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-text-primary">SEO &amp; Branding</h1>
        <p className="text-sm text-text-secondary mt-1">
          Global metadata used across public pages. Changes apply immediately.
        </p>
      </div>
      <Suspense>
        <SeoPreviewCard config={config} />
      </Suspense>
      <SeoConfigForm config={config} />
    </div>
  )
}
