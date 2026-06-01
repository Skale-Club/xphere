import { Building2, Globe, Phone, ExternalLink } from 'lucide-react'
import type { AccountRow } from '@/lib/accounts'
import { relativeTime } from '@/lib/pipeline/format'
import { formatPhoneDisplay } from '@/lib/phone-numbers/format'

interface Props {
  account: AccountRow
}

export function AccountDetailHeader({ account }: Props) {
  return (
    <div className="rounded-[12px] border border-border bg-bg-secondary p-6">
      <div className="flex items-start gap-4">
        {/* Company logo (read-only here; editing lives in the modal) */}
        <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-[12px] bg-bg-tertiary">
          {account.avatar_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={account.avatar_url} alt="" className="h-full w-full object-cover" />
          ) : (
            <Building2 className="h-6 w-6 text-text-secondary" />
          )}
        </div>

        <div className="min-w-0 flex-1">
          {/* Eyebrow breadcrumb */}
          <div className="flex items-center gap-2 text-[12px] font-medium uppercase tracking-[0.08em] text-text-tertiary">
            <Building2 className="h-3.5 w-3.5 text-accent" />
            <span>Xphere / Companies</span>
          </div>

          {/* Company name */}
          <h1 className="mt-2 text-[26px] font-semibold tracking-tight text-text-primary">
            {account.name}
          </h1>
        </div>
      </div>

      {/* Pill grid: domain, industry, size, tags */}
      <div className="mt-3 flex flex-wrap gap-2">
        {account.domain && (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-border-subtle bg-bg-primary px-2.5 py-1 text-[12px] text-text-secondary">
            <Globe className="h-3 w-3 text-text-tertiary" />
            {account.domain}
          </span>
        )}
        {account.industry && (
          <span className="inline-flex items-center rounded-full border border-border-subtle bg-bg-primary px-2.5 py-1 text-[12px] text-text-secondary">
            {account.industry}
          </span>
        )}
        {account.size && (
          <span className="inline-flex items-center rounded-full border border-border-subtle bg-bg-primary px-2.5 py-1 text-[12px] text-text-secondary">
            {account.size}
          </span>
        )}
        {account.tags && account.tags.length > 0 &&
          account.tags.map((tag) => (
            <span
              key={tag}
              className="inline-flex items-center rounded-full bg-accent-muted px-2.5 py-1 text-[11px] font-medium text-accent"
            >
              {tag}
            </span>
          ))}
      </div>

      {/* Secondary row: phone, website, address */}
      {(account.phone || account.website || account.address) && (
        <div className="mt-4 flex flex-wrap gap-4 text-[13px] text-text-secondary">
          {account.phone && (
            <a
              href={`tel:${account.phone}`}
              className="inline-flex items-center gap-1.5 hover:text-text-primary transition-colors"
            >
              <Phone className="h-3.5 w-3.5 text-text-tertiary" />
              {formatPhoneDisplay(account.phone)}
            </a>
          )}
          {account.website && (
            <a
              href={account.website}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 hover:text-text-primary transition-colors"
            >
              <ExternalLink className="h-3.5 w-3.5 text-text-tertiary" />
              {account.website}
            </a>
          )}
          {account.address && (
            <span className="text-text-secondary">{account.address}</span>
          )}
        </div>
      )}

      {/* Footer: added timestamp */}
      <p className="mt-4 text-[12px] text-text-tertiary">
        Added {relativeTime(account.created_at)}
      </p>
    </div>
  )
}
