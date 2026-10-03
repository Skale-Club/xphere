import { orgRedirect } from '@/lib/org/redirect'

export default async function VoiceRedirect() {
  return orgRedirect('/calls')
}
