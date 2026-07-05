'use client'

import { useState, useTransition } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { Check, ChevronsUpDown, Plus, Loader2, Settings2 } from 'lucide-react'
import { toast } from 'sonner'
import { switchOrganization, createOrganization, getUserOrgs } from '@/app/(dashboard)/organizations/actions'
import { sectionRootForPath } from '@/components/layout/nav-items'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { cn } from '@/lib/utils'

interface OrgSwitcherProps {
  currentOrgId: string | null
  currentOrgName: string | null
  currentOrgLogo?: string | null
  /** Compact (icon-only) when used inside a collapsed sidebar */
  collapsed?: boolean
  /** Server-preloaded org list — when present, skips the lazy fetch on first dropdown open. */
  initialOrgs?: Org[]
  /** 'lg' matches the full-width card rows in the mobile menu; 'sm' (default) is the compact topbar/sidebar pill. */
  size?: 'sm' | 'lg'
}

export interface Org {
  id: string
  name: string
  logo_url: string | null
}

// Small square org avatar: logo image when present, else a colored initial.
function OrgAvatar({ name, logo, size = 18 }: { name: string | null; logo?: string | null; size?: number }) {
  const initial = (name ?? '?').trim().charAt(0).toUpperCase() || '?'
  return (
    <span
      className="flex shrink-0 items-center justify-center overflow-hidden rounded-[5px] bg-bg-tertiary text-[10px] font-semibold text-text-secondary ring-1 ring-border-subtle"
      style={{ width: size, height: size }}
    >
      {logo ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={logo} alt="" className="h-full w-full object-cover" />
      ) : (
        initial
      )}
    </span>
  )
}

const createOrgSchema = z.object({
  name: z.string().min(1, 'Name is required.').max(100, 'Max 100 characters.'),
})
type CreateOrgValues = z.infer<typeof createOrgSchema>

function CreateOrgDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const [isPending, startTransition] = useTransition()
  const pathname = usePathname()

  const form = useForm<CreateOrgValues>({
    resolver: zodResolver(createOrgSchema),
    defaultValues: { name: '' },
  })

  function onSubmit(values: CreateOrgValues) {
    startTransition(async () => {
      const result = await createOrganization({ name: values.name })
      if (result && 'error' in result && result.error) {
        toast.error(result.error)
        return
      }
      // Creating an org switches the active org. Hard reload to the section root
      // so the whole tab re-renders under the new org (coherent, no stale cache).
      window.location.assign(sectionRootForPath(pathname))
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>New Organization</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-4 pt-2">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Organization name</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g. Example Organization" disabled={isPending} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="flex gap-2 justify-end">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>
                Cancel
              </Button>
              <Button type="submit" disabled={isPending} loading={isPending}>
                {isPending ? 'Creating...' : 'Create'}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}

export function OrgSwitcher({ currentOrgId, currentOrgName, currentOrgLogo, collapsed = false, initialOrgs, size = 'sm' }: OrgSwitcherProps) {
  const [isSwitching, startSwitchTransition] = useTransition()
  const [createOpen, setCreateOpen] = useState(false)
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [orgs, setOrgs] = useState<Org[] | null>(initialOrgs ?? null)
  const [isLoadingOrgs, setIsLoadingOrgs] = useState(false)
  const router = useRouter()
  const pathname = usePathname()

  async function handleDropdownOpen(open: boolean) {
    setDropdownOpen(open)
    if (open && orgs === null && !isLoadingOrgs) {
      setIsLoadingOrgs(true)
      try {
        const list = await getUserOrgs()
        setOrgs(list)
      } finally {
        setIsLoadingOrgs(false)
      }
    }
  }

  function handleSwitch(orgId: string) {
    if (orgId === currentOrgId || isSwitching) return
    startSwitchTransition(async () => {
      const result = await switchOrganization(orgId)
      if (result.error) {
        toast.error(result.error)
        return
      }
      // Hard reload to the section root so the ENTIRE tab re-renders under the
      // new org resolved from the DB (topbar, theme, data, RLS all coherent) —
      // no stale Router/ISR cache, no split-brain, and no 404 on deep routes.
      window.location.assign(sectionRootForPath(pathname))
    })
  }

  return (
    <>
      <DropdownMenu open={dropdownOpen} onOpenChange={handleDropdownOpen}>
        <DropdownMenuTrigger asChild>
          <button
            disabled={isSwitching}
            aria-label="Switch organization"
            className={cn(
              'flex w-full items-center text-left font-medium motion-fast',
              'border border-border-subtle bg-bg-tertiary/40 hover:bg-bg-tertiary hover:border-border',
              'text-text-primary',
              collapsed && 'justify-center',
              size === 'lg'
                ? 'gap-3 rounded-[14px] px-4 py-4 text-base'
                : 'gap-2 rounded-[7px] px-2 py-1.5 text-[12.5px]',
            )}
          >
            {isSwitching ? (
              <Loader2 className={cn('shrink-0 animate-spin text-text-tertiary', size === 'lg' ? 'h-5 w-5' : 'h-3.5 w-3.5')} />
            ) : (
              <OrgAvatar name={currentOrgName} logo={currentOrgLogo} size={collapsed ? 22 : size === 'lg' ? 28 : 18} />
            )}
            {!collapsed && (
              <>
                <span className={cn('truncate flex-1', size === 'lg' ? 'max-w-none' : 'max-w-[140px]')}>
                  {currentOrgName ?? 'Select organization'}
                </span>
                <ChevronsUpDown className={cn('shrink-0 text-text-tertiary', size === 'lg' ? 'h-4 w-4' : 'h-3 w-3')} />
              </>
            )}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" side={collapsed ? 'right' : size === 'lg' ? 'bottom' : 'top'} className="w-60">
          {isLoadingOrgs ? (
            <div className="flex items-center gap-2 px-2 py-1.5 text-sm text-text-tertiary">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Loading...
            </div>
          ) : (
            (orgs ?? []).map(org => (
              <DropdownMenuItem
                key={org.id}
                onClick={() => handleSwitch(org.id)}
                className="cursor-pointer gap-2"
              >
                <OrgAvatar name={org.name} logo={org.logo_url} size={20} />
                <span className="flex-1 truncate">{org.name}</span>
                <Check
                  className={`h-3.5 w-3.5 shrink-0 ${org.id === currentOrgId ? 'opacity-100 text-accent' : 'opacity-0'}`}
                />
              </DropdownMenuItem>
            ))
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={() => { setDropdownOpen(false); setCreateOpen(true) }}
            className="cursor-pointer gap-2 text-text-secondary"
          >
            <Plus className="h-3.5 w-3.5 shrink-0" />
            Add organization
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => { setDropdownOpen(false); router.push('/organizations') }}
            className="cursor-pointer gap-2 text-text-secondary"
          >
            <Settings2 className="h-3.5 w-3.5 shrink-0" />
            Manage organizations
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <CreateOrgDialog open={createOpen} onOpenChange={setCreateOpen} />
    </>
  )
}
