import { redirect } from 'next/navigation'
import { getUser } from '@/lib/supabase/server'
import { getOrCreateTrafficSetup } from './actions'
import { SetupScreen } from './_components/setup-screen'
import { VerifyScreen } from './_components/verify-screen'
import { WaitingScreen } from './_components/waiting-screen'
import { DashboardView } from './_components/dashboard-view'

export default async function TrafficPage() {
  const user = await getUser()
  if (!user) redirect('/')

  const setup = await getOrCreateTrafficSetup()
  if (!setup) redirect('/dashboard')

  const state = setup.verification_state

  if (state === 'not_started' || state === 'failed') {
    return <SetupScreen setup={setup} />
  }

  if (state === 'pending') {
    return <VerifyScreen setup={setup} />
  }

  if (state === 'no_events_yet') {
    return <WaitingScreen setup={setup} />
  }

  // state === 'verified' — show dashboard
  return <DashboardView setup={setup} />
}
