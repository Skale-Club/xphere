import { orgRedirect } from '@/lib/org/redirect'

export default async function SettingsPhoneNumbersRedirect() {
  return orgRedirect('/calls?settings=numbers')
}
