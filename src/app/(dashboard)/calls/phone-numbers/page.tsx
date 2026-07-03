import { redirect } from 'next/navigation'

// Phone numbers now live in the Voice Settings modal on the Calls page.
export default function CallsPhoneNumbersRedirect() {
  redirect('/calls?settings=numbers')
}
