import { getSeoConfig } from '../_actions/seo-config'
import { SeoConfigForm } from '@/components/admin/seo-config-form'

export default async function AdminSeoPage() {
  let config
  try {
    config = await getSeoConfig()
  } catch {
    return (
      <div className="p-6">
        <p className="text-[#A1A1AA] text-sm">
          Failed to load SEO config. Run the migration (070_seo_config.sql) and refresh.
        </p>
      </div>
    )
  }

  return (
    <div className="p-6 max-w-2xl">
      <div className="mb-6">
        <h1 className="text-[1.25rem] font-semibold text-[#FAFAFA] tracking-[-0.015em]">SEO Settings</h1>
        <p className="text-[0.8125rem] text-[#A1A1AA] mt-1">
          Global metadata used across public pages. Apply changes and redeploy to take effect.
        </p>
      </div>
      <SeoConfigForm config={config} />
    </div>
  )
}
