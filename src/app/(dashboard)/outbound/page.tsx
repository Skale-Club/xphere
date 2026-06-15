import { redirect } from 'next/navigation'

export default function OutboundPage() {
  redirect('/campaigns?channel=calls')
}
