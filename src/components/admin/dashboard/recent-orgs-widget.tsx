import Link from 'next/link'
import { ChevronRight } from 'lucide-react'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import type { RecentOrg } from '@/app/(admin)/admin/_actions/get-platform-dashboard'

export function RecentOrgsWidget({ orgs }: { orgs: RecentOrg[] }) {
  return (
    <Card>
      <CardHeader className="pb-2 pt-4 px-4">
        <p className="text-sm font-semibold text-text-primary">Recent Organizations</p>
      </CardHeader>
      <Separator className="bg-border-subtle" />
      <CardContent className="p-0">
        {orgs.length === 0 ? (
          <p className="text-sm text-text-secondary p-4">No organizations yet.</p>
        ) : (
          <ul className="divide-y divide-border-subtle">
            {orgs.map(org => (
              <li key={org.id}>
                <Link href={`/admin/orgs/${org.id}`} className="flex items-center justify-between px-4 py-2.5 hover:bg-bg-tertiary transition-colors duration-100">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-text-primary truncate">{org.name}</p>
                    <p className="text-xs text-text-tertiary font-mono">{org.slug}</p>
                  </div>
                  <div className="flex items-center gap-3 ml-3 shrink-0">
                    <span className={`text-xs rounded-full px-1.5 py-0.5 border ${
                      org.is_active
                        ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20'
                        : 'bg-bg-tertiary text-text-tertiary border-border'
                    }`}>
                      {org.is_active ? 'Active' : 'Inactive'}
                    </span>
                    <span className="hidden sm:inline text-xs text-text-tertiary tabular-nums">{org.members_count} members</span>
                    <ChevronRight className="h-3.5 w-3.5 text-text-tertiary" />
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
