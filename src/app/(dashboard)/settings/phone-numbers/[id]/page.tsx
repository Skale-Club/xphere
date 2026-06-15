import { redirect } from 'next/navigation'

interface Props {
  params: Promise<{ id: string }>
}

export default async function SettingsPhoneNumberDetailRedirect({ params }: Props) {
  const { id } = await params
  redirect(`/calls/phone-numbers/${id}`)
}
