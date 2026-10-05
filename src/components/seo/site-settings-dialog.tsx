'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Loader2, Settings2, Trash2 } from 'lucide-react'

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { deleteSite, updateSite } from '@/app/(dashboard)/seo/actions'
import { SiteCrawlFields, type Schedule } from './site-form-fields'

export function SiteSettingsDialog({
  site,
}: {
  site: { id: string; name: string; root_url: string; audit_schedule: Schedule; crawl_max_pages: number }
}) {
  const router = useRouter()
  const [open, setOpen] = React.useState(false)
  const [name, setName] = React.useState(site.name)
  const [schedule, setSchedule] = React.useState<Schedule>(site.audit_schedule)
  const [maxPages, setMaxPages] = React.useState(site.crawl_max_pages)
  const [saving, startSave] = React.useTransition()
  const [deleting, startDelete] = React.useTransition()

  function save() {
    startSave(async () => {
      const res = await updateSite(site.id, { name, schedule, maxPages })
      if (!res.ok) return void toast.error(res.error)
      toast.success('Settings saved')
      setOpen(false)
      router.refresh()
    })
  }

  function remove() {
    startDelete(async () => {
      const res = await deleteSite(site.id)
      if (!res.ok) return void toast.error(res.error)
      toast.success('Site removed')
      router.push('/seo')
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Settings2 className="mr-1.5 h-4 w-4" />
          Settings
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="mt-0 leading-tight">Site settings</DialogTitle>
        </DialogHeader>
        <div className="mt-2 space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="seo-site-name">Name</Label>
            <Input id="seo-site-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
            <p className="text-xs text-text-tertiary">{site.root_url}</p>
          </div>
          <SiteCrawlFields schedule={schedule} maxPages={maxPages} onScheduleChange={setSchedule} onMaxPagesChange={setMaxPages} />
          <div className="flex items-center justify-between gap-2 pt-2">
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button type="button" variant="ghost" className="text-danger hover:text-danger" disabled={deleting}>
                  <Trash2 className="mr-1.5 h-4 w-4" />
                  Remove site
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Remove {site.name}?</AlertDialogTitle>
                  <AlertDialogDescription>All audits and their history for this site are deleted. This cannot be undone.</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Keep</AlertDialogCancel>
                  <AlertDialogAction onClick={remove}>Remove</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="button" onClick={save} disabled={saving || !name.trim()}>
                {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Save
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
