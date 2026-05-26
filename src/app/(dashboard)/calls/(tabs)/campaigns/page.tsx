import { redirect } from 'next/navigation'

// Campaigns have moved to the top-level /campaigns module.
// Redirect so bookmarks and existing links continue to work.
export default function CallsCampaignsPage() {
  redirect('/campaigns?channel=calls')
}
