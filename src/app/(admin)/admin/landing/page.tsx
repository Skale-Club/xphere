import { getLandingConfig } from '../_actions/landing-config'
import { LandingConfigForm } from '@/components/admin/landing-config-form'

export default async function AdminLandingPage() {
  let config
  try {
    config = await getLandingConfig()
  } catch {
    return (
      <div className="p-6">
        <p className="text-sm text-text-secondary">
          Failed to load landing config. Run migration 1050_landing_config.sql and refresh.
        </p>
      </div>
    )
  }

  return (
    <div className="p-4 sm:p-6">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-text-primary">Landing Page</h1>
        <p className="text-sm text-text-secondary mt-1">
          Swap the CTA background image and curate the scroll-animation sequence. Changes apply immediately.
        </p>
      </div>
      <LandingConfigForm config={config} />
    </div>
  )
}
