export default function CampaignsLoading() {
  return (
    <div className="mx-auto w-full px-4 sm:px-6 lg:px-8 py-8 space-y-8 animate-pulse">
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <div className="h-7 w-36 rounded bg-bg-tertiary" />
          <div className="h-4 w-72 rounded bg-bg-tertiary" />
        </div>
        <div className="h-8 w-36 rounded bg-bg-tertiary" />
      </div>
      <div className="h-10 rounded bg-bg-tertiary" />
      <div className="rounded-[12px] border border-border overflow-hidden">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="flex items-center gap-3 px-4 py-3 border-b border-border-subtle last:border-0">
            <div className="h-4 flex-1 rounded bg-bg-tertiary" />
            <div className="h-4 w-16 rounded bg-bg-tertiary" />
            <div className="h-4 w-20 rounded bg-bg-tertiary" />
          </div>
        ))}
      </div>
    </div>
  )
}
