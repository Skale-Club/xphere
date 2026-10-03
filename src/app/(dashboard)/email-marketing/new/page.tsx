import { orgRedirect } from '@/lib/org/redirect'

// Deprecated: the legacy /email-marketing system has been retired in favor
// of the block-based builder. See
// .planning/workstreams/email-builder-hardening/PLAN.md Phase 5.
export default async function NewEmailTemplatePage() {
  return orgRedirect('/settings/email-templates/new')
}
