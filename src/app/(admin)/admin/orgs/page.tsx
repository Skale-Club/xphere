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
          <h1 className="text-[1.25rem] font-semibold text-[#FAFAFA] tracking-[-0.015em]">Organizations</h1>
          <p className="text-[0.8125rem] text-[#A1A1AA] mt-1">All tenant organizations on the platform</p>
        </div>
        <p className="text-[#A1A1AA] text-sm">Failed to load organizations. Check your connection and refresh the page.</p>
      </div>
    )
  }

  return (
    <div className="p-6 max-w-7xl">
      <div className="mb-6">
        <h1 className="text-[1.25rem] font-semibold text-[#FAFAFA] tracking-[-0.015em]">Organizations</h1>
        <p className="text-[0.8125rem] text-[#A1A1AA] mt-1">All tenant organizations on the platform</p>
      </div>
      <OrgsTable orgs={orgs} />
    </div>
  )
}
