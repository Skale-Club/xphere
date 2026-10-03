import { orgRedirect } from '@/lib/org/redirect'

export default async function SettingsCallsRedirect() {
  return orgRedirect('/calls?settings=routing')
}
