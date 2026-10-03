import { orgRedirect } from '@/lib/org/redirect'

// Voice campaigns live in the multi-channel Campaigns module.
export default async function CallsCampaignsRedirect() {
  return orgRedirect('/campaigns?channel=calls')
}
