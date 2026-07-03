import { redirect } from 'next/navigation'

// The standalone number editor page was removed — numbers are edited via the
// dialog inside Voice Settings › Phone Numbers.
export default function CallsPhoneNumberDetailRedirect() {
  redirect('/calls?settings=numbers')
}
