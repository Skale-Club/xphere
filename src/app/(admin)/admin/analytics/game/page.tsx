import { AnalyticsNav } from '../_components/analytics-nav'
import { GameAdminView } from './_components/game-admin-view'

// Access is gated by the admin layout (PLATFORM_ADMIN_EMAIL); every server
// action behind this page re-checks it before touching the service-role client.
export default function AdminGameAnalyticsPage() {
  return (
    <div className="p-4 sm:p-6">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-text-primary">Game Analytics</h1>
        <p className="text-sm text-text-secondary mt-1">
          Balance, engagement and health of the games, across organizations or for one. Studio tooling only: nothing here is shown to players.
        </p>
      </div>
      <AnalyticsNav />
      <GameAdminView />
    </div>
  )
}
