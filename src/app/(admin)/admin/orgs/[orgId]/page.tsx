import { getOrgDetail } from '../../_actions/get-org-detail'
import { OrgDetailView } from '@/components/admin/org-detail-view'

export default async function AdminOrgDetailPage({ params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params

  let org
  try {
    org = await getOrgDetail(orgId)
  } catch {
    return (
      <div className="p-6">
        <p className="text-[#A1A1AA] text-sm">Failed to load organization. Check your connection and refresh the page.</p>
      </div>
    )
  }

  return <OrgDetailView org={org} />
}
