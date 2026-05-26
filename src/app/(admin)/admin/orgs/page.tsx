import { getAllOrgs } from '../_actions/get-all-orgs'
import { OrgsTable } from '@/components/admin/orgs-table'

export default async function AdminOrgsPage() {
  let orgs
  try {
    orgs = await getAllOrgs()
  } catch {
    return (
      <div className="p-6">
        <div className="mb-6">
          <h1 className="text-xl font-semibold text-text-primary">Organizations</h1>
          <p className="text-sm text-text-secondary mt-1">All tenant organizations on the platform</p>
        </div>
        <p className="text-sm text-text-secondary">Failed to load organizations. Check your connection and refresh the page.</p>
      </div>
    )
  }

  return (
    <div className="p-4 sm:p-6">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-text-primary">Organizations</h1>
        <p className="text-sm text-text-secondary mt-1">All tenant organizations on the platform</p>
      </div>
      <OrgsTable orgs={orgs} />
    </div>
  )
}
