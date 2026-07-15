import { redirect } from 'next/navigation'

// Deprecated: the legacy /email-marketing system has been retired in favor
// of the block-based builder. See
// .planning/workstreams/email-builder-hardening/PLAN.md Phase 5.
export default function NewEmailTemplatePage() {
  redirect('/settings/email-templates/new')
}
