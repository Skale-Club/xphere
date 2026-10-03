import { orgRedirect } from '@/lib/org/redirect'

// Phone numbers now live in the Voice Settings modal on the Calls page.
export default async function CallsPhoneNumbersRedirect() {
  return orgRedirect('/calls?settings=numbers')
}
