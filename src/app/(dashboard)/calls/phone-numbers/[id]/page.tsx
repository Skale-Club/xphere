import { orgRedirect } from '@/lib/org/redirect'

// The standalone number editor page was removed — numbers are edited via the
// dialog inside Voice Settings › Phone Numbers.
export default async function CallsPhoneNumberDetailRedirect() {
  return orgRedirect('/calls?settings=numbers')
}
