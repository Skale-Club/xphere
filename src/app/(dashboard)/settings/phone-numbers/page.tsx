import { redirect } from 'next/navigation'

export default function SettingsPhoneNumbersRedirect() {
  redirect('/calls?settings=numbers')
}
