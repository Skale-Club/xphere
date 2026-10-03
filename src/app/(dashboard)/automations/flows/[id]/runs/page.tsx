import { orgRedirect } from '@/lib/org/redirect'
export default async function FlowRunsLegacyRedirect({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  return orgRedirect(`/workflows/flows/${id}/runs`)
}
