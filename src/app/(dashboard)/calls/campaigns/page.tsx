import { redirect } from 'next/navigation'

// Voice campaigns live in the multi-channel Campaigns module.
export default function CallsCampaignsRedirect() {
  redirect('/campaigns?channel=calls')
}
