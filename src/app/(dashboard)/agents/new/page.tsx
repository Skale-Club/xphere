import { redirect } from 'next/navigation'

// Agent creation is popup-only (NewAgentDialog from the sidebar). This legacy
// full-page form route now just redirects to the list so old links/bookmarks
// don't dead-end.
export default function NewAgentPage() {
  redirect('/agents')
}
