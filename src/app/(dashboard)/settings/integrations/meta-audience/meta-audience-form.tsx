'use client'

import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { toast } from 'sonner'
import { Loader2, RefreshCw, ToggleLeft, ToggleRight } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { Badge } from '@/components/ui/badge'
import {
  saveMetaAudienceConfig,
  toggleMetaAudienceSync,
  type MetaAudienceConfigRow,
} from './actions'

const schema = z.object({
  meta_ad_account_id: z
    .string()
    .trim()
    .min(1, 'Required')
    .regex(/^act_\d+$/, 'Must be in the format act_XXXXXXXXX'),
  meta_business_id: z.string().trim().optional().or(z.literal('')),
  audience_name: z.string().trim().max(200).optional().or(z.literal('')),
  terms_accepted: z.boolean(),
})

type FormValues = z.infer<typeof schema>

interface Props {
  config: MetaAudienceConfigRow | null
}

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
}

export function MetaAudienceForm({ config }: Props) {
  const [toggling, setToggling] = useState(false)

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    setValue,
    watch,
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      meta_ad_account_id: config?.meta_ad_account_id ?? '',
      meta_business_id: config?.meta_business_id ?? '',
      audience_name: config?.audience_name ?? '',
      terms_accepted: !!config?.terms_accepted_at,
    },
  })

  const termsAccepted = watch('terms_accepted')
  const syncEnabled = config?.sync_enabled ?? false

  async function onSubmit(values: FormValues) {
    const result = await saveMetaAudienceConfig(values)
    if (result.ok) {
      toast.success('Configuration saved')
    } else {
      toast.error(result.error ?? 'Failed to save')
    }
  }

  async function handleToggleSync() {
    setToggling(true)
    try {
      const result = await toggleMetaAudienceSync(!syncEnabled)
      if (result.ok) {
        toast.success(syncEnabled ? 'Sync disabled' : 'Sync enabled')
      } else {
        toast.error(result.error ?? 'Failed to toggle sync')
      }
    } finally {
      setToggling(false)
    }
  }

  const stats = config?.last_sync_stats

  return (
    <div className="space-y-8">
      {/* Status card */}
      {config && (
        <div className="rounded-lg border bg-muted/30 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Sync status</span>
            <Badge variant={syncEnabled ? 'default' : 'secondary'}>
              {syncEnabled ? 'Active' : 'Paused'}
            </Badge>
          </div>
          <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm text-muted-foreground">
            <span>Last sync</span>
            <span className="text-foreground">{formatDate(config.last_synced_at)}</span>
            {stats && (
              <>
                <span>Contacts sent</span>
                <span className="text-foreground">{stats.sent ?? 0}</span>
                <span>Removed</span>
                <span className="text-foreground">{stats.removed ?? 0}</span>
                {(stats.error_count ?? 0) > 0 && (
                  <>
                    <span className="text-destructive">Errors</span>
                    <span className="text-destructive">{stats.error_count}</span>
                  </>
                )}
              </>
            )}
            {config.custom_audience_id && (
              <>
                <span>Audience ID</span>
                <span className="font-mono text-xs text-foreground">{config.custom_audience_id}</span>
              </>
            )}
          </div>

          <Button
            type="button"
            variant={syncEnabled ? 'outline' : 'default'}
            size="sm"
            onClick={handleToggleSync}
            disabled={toggling || !config.terms_accepted_at}
            className="w-full mt-1"
          >
            {toggling ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : syncEnabled ? (
              <ToggleLeft className="mr-2 h-4 w-4" />
            ) : (
              <ToggleRight className="mr-2 h-4 w-4" />
            )}
            {syncEnabled ? 'Pause sync' : 'Enable sync'}
          </Button>
        </div>
      )}

      {/* Config form */}
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
        <div className="space-y-1.5">
          <Label htmlFor="meta_ad_account_id">Meta Ad Account ID</Label>
          <Input
            id="meta_ad_account_id"
            placeholder="act_123456789"
            {...register('meta_ad_account_id')}
          />
          {errors.meta_ad_account_id && (
            <p className="text-xs text-destructive">{errors.meta_ad_account_id.message}</p>
          )}
          <p className="text-xs text-muted-foreground">
            Found in Meta Ads Manager → Account Overview. Starts with <code>act_</code>.
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="meta_business_id">Meta Business ID (optional)</Label>
          <Input
            id="meta_business_id"
            placeholder="123456789"
            {...register('meta_business_id')}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="audience_name">Audience name</Label>
          <Input
            id="audience_name"
            placeholder="Xphere CRM — My Company"
            {...register('audience_name')}
          />
          <p className="text-xs text-muted-foreground">
            This name will appear in Meta Ads Manager. Changing it does not rename an existing audience.
          </p>
        </div>

        <div className="flex items-start gap-3 rounded-lg border p-4 bg-muted/20">
          <Checkbox
            id="terms_accepted"
            checked={termsAccepted}
            onCheckedChange={(v) => setValue('terms_accepted', !!v)}
            disabled={!!config?.terms_accepted_at}
          />
          <div className="space-y-1">
            <label htmlFor="terms_accepted" className="text-sm font-medium leading-none cursor-pointer">
              I accept the Meta Customer List Custom Audiences terms
            </label>
            <p className="text-xs text-muted-foreground">
              By enabling this feature you confirm that your organization has the right to use
              your contacts' data for advertising, and that your privacy policy covers this use.
              Required by Meta.{' '}
              <a
                href="https://www.facebook.com/legal/terms/customaudience"
                target="_blank"
                rel="noopener noreferrer"
                className="underline"
              >
                Read terms
              </a>
            </p>
            {config?.terms_accepted_at && (
              <p className="text-xs text-muted-foreground">
                Accepted on {formatDate(config.terms_accepted_at)}
              </p>
            )}
          </div>
        </div>

        <Button type="submit" disabled={isSubmitting} className="w-full sm:w-auto">
          {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {config ? 'Save changes' : 'Save configuration'}
        </Button>
      </form>

      {/* Info footer */}
      <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground space-y-2">
        <div className="flex items-center gap-2 font-medium text-foreground">
          <RefreshCw className="h-4 w-4" />
          How it works
        </div>
        <ul className="list-disc list-inside space-y-1">
          <li>Contacts are hashed (SHA-256) before leaving Xphere — raw emails and phones are never sent.</li>
          <li>The sync runs hourly and is incremental — only contacts updated since the last run are pushed.</li>
          <li>Contacts with DND enabled are automatically removed from the audience.</li>
          <li>Meta requires at least ~100 matched contacts for delivery. Small orgs may not reach threshold.</li>
          <li>Phone numbers match better than corporate emails on Meta.</li>
        </ul>
      </div>
    </div>
  )
}
