import { orgRedirect } from '@/lib/org/redirect'

// The old "Call setup" hub was retired — Voice Settings modal replaces it.
export default async function CallsSettingsRedirect() {
  return orgRedirect('/calls?settings=numbers')
}
