import { orgRedirect } from '@/lib/org/redirect'

// Deprecated: the legacy /email-marketing system (including its global
// sections library) has been retired in favor of the block-based builder's
// reusable section templates. See
// .planning/workstreams/email-builder-hardening/PLAN.md Phase 5.
export default async function EmailSectionsPage() {
  return orgRedirect('/settings/email-templates')
}
