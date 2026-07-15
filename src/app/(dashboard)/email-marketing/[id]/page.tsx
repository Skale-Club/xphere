import { redirect } from 'next/navigation'

// Deprecated: the legacy /email-marketing system has been retired in favor
// of the block-based builder. See
// .planning/workstreams/email-builder-hardening/PLAN.md Phase 5.
export default async function EmailTemplatePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  redirect(`/settings/email-templates/${id}`)
}
