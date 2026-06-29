import { redirect } from 'next/navigation'
import { getUser } from '@/lib/supabase/server'
import { getOrCreateAnalyticsSetup } from './actions'
import { SetupWizard } from './_components/setup-wizard'
import { WaitingScreen } from './_components/waiting-screen'
import { DashboardView } from './_components/dashboard-view'

export default async function AnalyticsPage() {
  const user = await getUser()
  if (!user) redirect('/')

  const setup = await getOrCreateAnalyticsSetup()
  if (!setup) redirect('/dashboard')

  const state = setup.verification_state

  // Script detected but no traffic yet — dedicated "waiting for first visit" screen.
  if (state === 'no_events_yet') {
    return <WaitingScreen setup={setup} />
  }

  // Data is flowing — show the dashboard.
  if (state === 'verified') {
    return <DashboardView setup={setup} />
  }

  // not_started | pending | failed — run the step-by-step setup wizard.
  return <SetupWizard setup={setup} />
}
