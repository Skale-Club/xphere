'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useForm, useFieldArray } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { toast } from 'sonner'
import { Plus, Trash2, Loader2, Pencil } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import {
  createManychatRule,
  updateManychatRule,
  deleteManychatRule,
} from '@/app/(dashboard)/integrations/manychat/rule-actions'
import { getManychatFlows } from '@/app/(dashboard)/integrations/manychat/actions'
import type { Database } from '@/types/database'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ManychatRuleRow = Database['public']['Tables']['manychat_rules']['Row']
type ToolConfigRow = Pick<
  Database['public']['Tables']['_legacy_tool_configs']['Row'],
  'id' | 'tool_name' | 'action_type' | 'is_active'
>
type ManychatFlow = { name: string; ns: string }

type ManychatRulesProps = {
  rules: ManychatRuleRow[]
  toolConfigs: ToolConfigRow[]
  channelId: string | null
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const conditionEntrySchema = z.object({
  key: z.string().min(1, 'Key required'),
  value: z.string(),
})

const ruleSchema = z.object({
  eventType: z.string().min(1, 'Event type is required'),
  flowNs: z.string().min(1, 'Flow is required'),
  toolConfigId: z.string().min(1, 'Tool config is required'),
  priority: z.coerce.number(),
  isActive: z.boolean(),
  conditions: z.array(conditionEntrySchema),
})

type RuleFormValues = z.infer<typeof ruleSchema>

// ---------------------------------------------------------------------------
// RuleFormSheet (inner component)
// ---------------------------------------------------------------------------

type RuleFormSheetProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  editingRule: ManychatRuleRow | null
  toolConfigs: ToolConfigRow[]
  channelId: string | null
  onSuccess: () => void
}

function RuleFormSheet({
  open,
  onOpenChange,
  editingRule,
  toolConfigs,
  channelId,
  onSuccess,
}: RuleFormSheetProps) {
  const [flows, setFlows] = useState<ManychatFlow[]>([])
  const [flowsLoading, setFlowsLoading] = useState(false)
  const [flowsError, setFlowsError] = useState<string | null>(null)

  const form = useForm<RuleFormValues>({
    resolver: zodResolver(ruleSchema),
    defaultValues: {
      eventType: '',
      flowNs: '',
      toolConfigId: '',
      priority: 0,
      isActive: true,
      conditions: [],
    },
  })

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: 'conditions',
  })

  // Pre-fill form when editing
  useEffect(() => {
    if (editingRule) {
      form.reset({
        eventType: editingRule.event_type,
        flowNs: '',
        toolConfigId: editingRule.tool_config_id,
        priority: editingRule.priority,
        isActive: editingRule.is_active,
        conditions: Object.entries(
          (editingRule.condition as Record<string, string>) ?? {}
        ).map(([k, v]) => ({ key: k, value: v })),
      })
    } else {
      form.reset({
        eventType: '',
        flowNs: '',
        toolConfigId: '',
        priority: 0,
        isActive: true,
        conditions: [],
      })
    }
  }, [editingRule, form])

  // Load flows when sheet opens
  useEffect(() => {
    if (!open) return
    setFlowsLoading(true)
    setFlowsError(null)
    getManychatFlows().then((result) => {
      if ('error' in result) {
        setFlowsError(result.error)
        setFlows([])
      } else {
        setFlows(result.flows)
      }
      setFlowsLoading(false)
    })
  }, [open])

  const onSubmit = useCallback(
    async (values: RuleFormValues) => {
      if (!editingRule && !channelId) {
        toast.error('No ManyChat channel configured.')
        return
      }

      const condition = Object.fromEntries(
        values.conditions.map((c) => [c.key, c.value])
      )

      if (editingRule) {
        const result = await updateManychatRule(editingRule.id, {
          eventType: values.eventType,
          condition,
          toolConfigId: values.toolConfigId,
          priority: values.priority,
          isActive: values.isActive,
        })
        if (result && result.error) {
          toast.error(result.error)
          return
        }
        toast.success('Rule updated.')
      } else {
        const result = await createManychatRule({
          channelId: channelId!,
          eventType: values.eventType,
          condition,
          toolConfigId: values.toolConfigId,
          priority: values.priority,
          isActive: values.isActive,
        })
        if (result && result.error) {
          toast.error(result.error)
          return
        }
        toast.success('Rule created.')
      }

      onSuccess()
      onOpenChange(false)
    },
    [editingRule, channelId, onSuccess, onOpenChange]
  )

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>{editingRule ? 'Edit Rule' : 'New Rule'}</SheetTitle>
          <SheetDescription>
            {editingRule
              ? 'Update this routing rule.'
              : 'Create a new routing rule to dispatch ManyChat events to an action.'}
          </SheetDescription>
        </SheetHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="mt-6 space-y-6">
            {/* Event Type */}
            <FormField
              control={form.control}
              name="eventType"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Event type</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g. flow_completed" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* ManyChat Flow */}
            <FormField
              control={form.control}
              name="flowNs"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>ManyChat Flow</FormLabel>
                  <p className="text-xs text-muted-foreground">
                    Select the flow to trigger or bind this rule to.
                  </p>
                  {flowsLoading ? (
                    <Select disabled>
                      <SelectTrigger>
                        <SelectValue placeholder="Loading flows…" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__loading">Loading flows…</SelectItem>
                      </SelectContent>
                    </Select>
                  ) : flowsError ? (
                    <>
                      <Select disabled>
                        <SelectTrigger>
                          <SelectValue placeholder="Could not load flows" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__error">Could not load flows</SelectItem>
                        </SelectContent>
                      </Select>
                      <p className="text-sm text-destructive">{flowsError}</p>
                    </>
                  ) : (
                    <Select
                      value={field.value}
                      onValueChange={field.onChange}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select a flow…" />
                      </SelectTrigger>
                      <SelectContent>
                        {flows.map((f) => (
                          <SelectItem key={f.ns} value={f.ns}>
                            {f.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Tool Config */}
            <FormField
              control={form.control}
              name="toolConfigId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Tool config</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select a tool config…" />
                    </SelectTrigger>
                    <SelectContent>
                      {toolConfigs.map((tc) => (
                        <SelectItem key={tc.id} value={tc.id}>
                          {tc.tool_name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Priority */}
            <FormField
              control={form.control}
              name="priority"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Priority</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      placeholder="0"
                      {...field}
                      onChange={(e) => field.onChange(e.target.valueAsNumber)}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Is Active */}
            <FormField
              control={form.control}
              name="isActive"
              render={({ field }) => (
                <FormItem>
                  <div className="flex items-center gap-2">
                    <FormControl>
                      <Switch
                        checked={field.value}
                        onCheckedChange={field.onChange}
                      />
                    </FormControl>
                    <Label>Active</Label>
                  </div>
                </FormItem>
              )}
            />

            {/* Conditions */}
            <div className="space-y-3">
              <Label>Conditions</Label>
              <p className="text-xs text-muted-foreground">
                Key/value pairs that must match the event payload. Leave empty for a catch-all rule.
              </p>
              {fields.map((field, index) => (
                <div key={field.id} className="flex items-center gap-2">
                  <Input
                    placeholder="key"
                    {...form.register(`conditions.${index}.key`)}
                  />
                  <span className="text-sm text-muted-foreground">=</span>
                  <Input
                    placeholder="value"
                    {...form.register(`conditions.${index}.value`)}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => remove(index)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => append({ key: '', value: '' })}
              >
                <Plus className="mr-2 h-4 w-4" /> Add condition
              </Button>
            </div>

            <SheetFooter>
              <Button
                type="submit"
                disabled={form.formState.isSubmitting}
              >
                {form.formState.isSubmitting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Saving…
                  </>
                ) : editingRule ? (
                  'Update Rule'
                ) : (
                  'Create Rule'
                )}
              </Button>
            </SheetFooter>
          </form>
        </Form>
      </SheetContent>
    </Sheet>
  )
}

// ---------------------------------------------------------------------------
// ManychatRules main component
// ---------------------------------------------------------------------------

export function ManychatRules({ rules, toolConfigs, channelId }: ManychatRulesProps) {
  const router = useRouter()
  const [sheetOpen, setSheetOpen] = useState(false)
  const [editingRule, setEditingRule] = useState<ManychatRuleRow | null>(null)
  const [deletingRuleId, setDeletingRuleId] = useState<string | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)

  const toolConfigMap = Object.fromEntries(toolConfigs.map((tc) => [tc.id, tc.tool_name]))

  function handleNewRule() {
    setEditingRule(null)
    setSheetOpen(true)
  }

  function handleEditRule(rule: ManychatRuleRow) {
    setEditingRule(rule)
    setSheetOpen(true)
  }

  function handleSuccess() {
    router.refresh()
  }

  async function handleConfirmDelete() {
    if (!deletingRuleId) return
    setIsDeleting(true)
    try {
      const result = await deleteManychatRule(deletingRuleId)
      if (result && result.error) {
        toast.error(result.error)
      } else {
        toast.success('Rule deleted.')
        router.refresh()
      }
    } finally {
      setIsDeleting(false)
      setDeletingRuleId(null)
    }
  }

  const conditionCount = (rule: ManychatRuleRow) =>
    Object.keys((rule.condition as Record<string, unknown>) ?? {}).length

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {rules.length === 0
            ? 'No rules yet. Create your first routing rule.'
            : `${rules.length} rule${rules.length === 1 ? '' : 's'}`}
        </p>
        <Button onClick={handleNewRule}>
          <Plus className="mr-2 h-4 w-4" /> New Rule
        </Button>
      </div>

      {rules.length > 0 && (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Event type</TableHead>
                <TableHead>Conditions</TableHead>
                <TableHead>Tool config</TableHead>
                <TableHead>Priority</TableHead>
                <TableHead>Active</TableHead>
                <TableHead className="w-20">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rules.map((rule) => (
                <TableRow key={rule.id}>
                  <TableCell className="font-mono text-xs">{rule.event_type}</TableCell>
                  <TableCell>
                    <Badge variant="secondary">
                      {conditionCount(rule)} condition{conditionCount(rule) === 1 ? '' : 's'}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm">
                    {toolConfigMap[rule.tool_config_id] ?? rule.tool_config_id.slice(0, 8) + '…'}
                  </TableCell>
                  <TableCell>{rule.priority}</TableCell>
                  <TableCell>
                    {rule.is_active ? (
                      <Badge variant="secondary" className="bg-green-100 text-green-800">
                        Active
                      </Badge>
                    ) : (
                      <Badge variant="secondary">Inactive</Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleEditRule(rule)}
                        aria-label="Edit rule"
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setDeletingRuleId(rule.id)}
                        aria-label="Delete rule"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <RuleFormSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        editingRule={editingRule}
        toolConfigs={toolConfigs}
        channelId={channelId}
        onSuccess={handleSuccess}
      />

      <AlertDialog
        open={deletingRuleId !== null}
        onOpenChange={(open) => {
          if (!open) setDeletingRuleId(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this routing rule?</AlertDialogTitle>
            <AlertDialogDescription>
              Events matching this rule will no longer be routed to the bound action. This cannot
              be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setDeletingRuleId(null)}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmDelete} disabled={isDeleting}>
              {isDeleting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Deleting…
                </>
              ) : (
                'Delete'
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
