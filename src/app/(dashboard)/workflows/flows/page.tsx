import { orgRedirect } from '@/lib/org/redirect'

// SEED-037: /workflows is the canonical unified list. Keep this route as a
// permanent redirect so existing bookmarks + old links continue to work.
export default async function FlowsListPage() {
  return orgRedirect('/workflows')
}
