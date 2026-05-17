'use client'

import * as React from 'react'
import { Smartphone, Monitor, ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'

interface ZoiperSetupGuideProps {
  sipDomain: string | null
  username: string | null
  password: string | null
}

type Platform = 'ios' | 'android' | 'windows' | 'mac'

const PLATFORMS: Array<{ id: Platform; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { id: 'ios', label: 'iOS', icon: Smartphone },
  { id: 'android', label: 'Android', icon: Smartphone },
  { id: 'mac', label: 'Mac', icon: Monitor },
  { id: 'windows', label: 'Windows', icon: Monitor },
]

const STEPS: Record<Platform, string[]> = {
  ios: [
    'Install Zoiper from the App Store.',
    'Tap Settings → Accounts → Add Account → Manual.',
    'Choose SIP UDP. Paste the domain, username, and password from above.',
    'Set Transport to TLS for encryption. Save and wait for the green dot.',
  ],
  android: [
    'Install Zoiper from Google Play.',
    'Open Settings → Accounts → Add Account → Manual configuration.',
    'Choose SIP. Enter the credentials and use port 5061 for TLS.',
    'Allow microphone + background permissions so calls ring while idle.',
  ],
  mac: [
    'Download Zoiper for macOS from zoiper.com.',
    'Settings → Preferences → Accounts → Add Account.',
    'Pick SIP. Paste the domain, username, and password. Use TLS transport.',
    'Test by dialing *43 (echo test).',
  ],
  windows: [
    'Install Zoiper for Windows from zoiper.com.',
    'Options → Preferences → Accounts → Add Account.',
    'Choose SIP, paste the credentials, and enable TLS.',
    'Allow Zoiper through Windows Defender Firewall on first ring.',
  ],
}

export function ZoiperSetupGuide({ sipDomain, username, password }: ZoiperSetupGuideProps) {
  const [open, setOpen] = React.useState(false)
  const [platform, setPlatform] = React.useState<Platform>('mac')

  return (
    <div className="rounded-[12px] border border-border bg-bg-primary">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
      >
        <div>
          <div className="text-[13px] font-medium text-text-primary">Zoiper setup guide</div>
          <p className="text-[11.5px] text-text-tertiary">
            Step-by-step instructions for iOS, Android, Mac, and Windows.
          </p>
        </div>
        <ChevronDown className={cn('h-4 w-4 text-text-tertiary transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="border-t border-border-subtle px-4 py-4 space-y-4">
          <div className="inline-flex rounded-[10px] border border-border bg-bg-secondary p-1">
            {PLATFORMS.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setPlatform(p.id)}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-[8px] px-3 py-1.5 text-[12px] font-medium transition-colors',
                  platform === p.id
                    ? 'bg-bg-tertiary text-text-primary shadow-sm'
                    : 'text-text-tertiary hover:text-text-primary',
                )}
              >
                <p.icon className="h-3.5 w-3.5" />
                {p.label}
              </button>
            ))}
          </div>

          <ol className="space-y-2">
            {STEPS[platform].map((step, i) => (
              <li key={i} className="flex gap-3 text-[12.5px] text-text-secondary">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-bg-tertiary text-[10.5px] font-medium text-text-secondary">
                  {i + 1}
                </span>
                <span className="leading-relaxed">{step}</span>
              </li>
            ))}
          </ol>

          {sipDomain && username && (
            <div className="rounded-[10px] border border-border-subtle bg-bg-secondary p-3 font-mono text-[11.5px] leading-relaxed text-text-secondary">
              <div>Domain: <span className="text-text-primary">{sipDomain}</span></div>
              <div>Username: <span className="text-text-primary">{username}</span></div>
              <div>Password: <span className="text-text-primary">{password ?? 'rotate to view'}</span></div>
              <div>Transport: <span className="text-text-primary">TLS (port 5061)</span></div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
