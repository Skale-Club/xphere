import { redirect } from 'next/navigation'

// SEED-037: /workflows is the canonical unified list. Keep this route as a
// permanent redirect so existing bookmarks + old links continue to work.
export default function FlowsListPage() {
  redirect('/workflows')
}
