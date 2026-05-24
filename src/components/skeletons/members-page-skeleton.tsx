import { Skeleton } from '@/components/ui/skeleton'

function MemberRowSkeleton() {
  return (
    <div className="flex items-center gap-4 px-4 py-3 border-b border-border-subtle last:border-0">
      <div className="flex items-center gap-2 flex-1 min-w-0">
        <Skeleton className="h-7 w-7 rounded-full shrink-0" />
        <Skeleton className="h-4 w-28" />
      </div>
      <Skeleton className="h-4 w-40 hidden sm:block" />
      <Skeleton className="h-4 w-24 hidden md:block" />
      <Skeleton className="h-7 w-[90px] rounded-[6px]" />
      <Skeleton className="h-4 w-20 hidden lg:block" />
      <Skeleton className="h-8 w-8 rounded-[6px]" />
    </div>
  )
}

function InviteRowSkeleton() {
  return (
    <div className="flex items-center gap-4 px-4 py-3 border-b border-border-subtle last:border-0">
      <Skeleton className="h-4 w-40 flex-1" />
      <Skeleton className="h-5 w-16 rounded-full" />
      <Skeleton className="h-4 w-20" />
      <Skeleton className="h-8 w-8 rounded-[6px]" />
    </div>
  )
}

export function MembersPageSkeleton() {
  return (
    <div className="mx-auto w-full px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      {/* Invite button */}
      <div className="flex items-center justify-end">
        <Skeleton className="h-9 w-[130px] rounded-[8px]" />
      </div>

      {/* Members table */}
      <section className="space-y-2">
        {/* Table header */}
        <div className="flex items-center gap-4 px-4 py-2.5 border-b border-border bg-bg-secondary text-[11px] font-medium uppercase tracking-wide text-text-tertiary">
          <span className="flex-1">Name</span>
          <span className="hidden sm:block w-40">Email</span>
          <span className="hidden md:block w-24">Phone</span>
          <span className="w-[90px]">Role</span>
          <span className="hidden lg:block w-20">Joined</span>
          <span className="w-8" />
        </div>
        {/* Table rows */}
        <div className="rounded-[12px] border border-border bg-bg-secondary overflow-hidden">
          {Array.from({ length: 6 }).map((_, i) => (
            <MemberRowSkeleton key={i} />
          ))}
        </div>
        {/* Pagination */}
        <div className="flex items-center justify-between pt-4 border-t mt-2">
          <Skeleton className="h-3 w-20" />
          <div className="flex items-center gap-1">
            <Skeleton className="h-8 w-8 rounded-[6px]" />
            <Skeleton className="h-8 w-8 rounded-[6px]" />
            <Skeleton className="h-8 w-8 rounded-[6px]" />
            <Skeleton className="h-8 w-8 rounded-[6px]" />
            <Skeleton className="h-8 w-8 rounded-[6px]" />
          </div>
        </div>
      </section>

      {/* Pending invites */}
      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-5 w-6 rounded-full" />
        </div>
        {/* Table header */}
        <div className="flex items-center gap-4 px-4 py-2.5 border-b border-border bg-bg-secondary text-[11px] font-medium uppercase tracking-wide text-text-tertiary">
          <span className="flex-1">Email</span>
          <span className="w-16">Role</span>
          <span className="w-20">Invited</span>
          <span className="w-8" />
        </div>
        <div className="rounded-[12px] border border-border bg-bg-secondary overflow-hidden">
          {Array.from({ length: 3 }).map((_, i) => (
            <InviteRowSkeleton key={i} />
          ))}
        </div>
      </section>
    </div>
  )
}
