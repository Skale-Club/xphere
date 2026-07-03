'use client'

import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { updateMessageTemplate, type MessageTemplateRow } from '../_actions/message-templates'

const schema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(200),
  body: z.string().min(1, 'Default body is required'),
  sms_override: z.string(),
  email_override: z.string(),
  whatsapp_override: z.string(),
})

type FormValues = z.infer<typeof schema>

interface Props {
  template: MessageTemplateRow
}

export function MessageTemplateEditor({ template }: Props) {
  const router = useRouter()

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: template.name,
      body: template.body,
      sms_override: template.channel_overrides.sms ?? '',
      email_override: template.channel_overrides.email ?? '',
      whatsapp_override: template.channel_overrides.whatsapp ?? '',
    },
  })

  async function onSubmit(values: FormValues) {
    const channel_overrides: Record<string, string> = {}
    if (values.sms_override.trim()) channel_overrides.sms = values.sms_override
    if (values.email_override.trim()) channel_overrides.email = values.email_override
    if (values.whatsapp_override.trim()) channel_overrides.whatsapp = values.whatsapp_override

    const result = await updateMessageTemplate(template.id, {
      name: values.name,
      body: values.body,
      channel_overrides,
    })

    if (!result.ok) {
      toast.error(result.error)
      return
    }
    toast.success('Template saved')
    router.refresh()
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6 max-w-2xl">
      <div className="space-y-1.5">
        <Label htmlFor="name">Name</Label>
        <Input id="name" {...register('name')} placeholder="e.g. Appointment reminder" />
        {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="body">Default body</Label>
        <Textarea id="body" rows={5} {...register('body')} placeholder="Used for any channel without an override below." />
        {errors.body && <p className="text-xs text-destructive">{errors.body.message}</p>}
      </div>

      <div className="space-y-1.5">
        <Label>Per-channel overrides (optional)</Label>
        <p className="text-xs text-muted-foreground">Leave a tab blank to fall back to the default body for that channel.</p>
        <Tabs defaultValue="sms">
          <TabsList>
            <TabsTrigger value="sms">SMS</TabsTrigger>
            <TabsTrigger value="email">Email</TabsTrigger>
            <TabsTrigger value="whatsapp">WhatsApp</TabsTrigger>
          </TabsList>
          <TabsContent value="sms">
            <Textarea rows={4} {...register('sms_override')} placeholder="SMS-specific body (optional)" />
          </TabsContent>
          <TabsContent value="email">
            <Textarea rows={4} {...register('email_override')} placeholder="Email-specific body (optional)" />
          </TabsContent>
          <TabsContent value="whatsapp">
            <Textarea rows={4} {...register('whatsapp_override')} placeholder="WhatsApp-specific body (optional)" />
          </TabsContent>
        </Tabs>
      </div>

      <Button type="submit" disabled={isSubmitting} className="gap-2">
        {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
        Save changes
      </Button>
    </form>
  )
}
