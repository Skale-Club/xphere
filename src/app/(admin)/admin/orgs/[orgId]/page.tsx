import { getOrgDetail } from '../../_actions/get-org-detail'
import { getOrgLocalSeoSettings } from '../../_actions/local-seo-actions'
import { OrgDetailView } from '@/components/admin/org-detail-view'

export default async function AdminOrgDetailPage({ params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params

  let org, localSeo
  try {
    ;[org, localSeo] = await Promise.all([getOrgDetail(orgId), getOrgLocalSeoSettings(orgId)])
  } catch {
    return (
      <div className="p-6">
        <p className="text-sm text-text-secondary">Failed to load organization. Check your connection and refresh the page.</p>
      </div>
    )
  }

  return <OrgDetailView org={org} localSeo={localSeo} />
}
