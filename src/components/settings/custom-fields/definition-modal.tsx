'use client'

import { useEffect, useTransition } from 'react'
import { useForm, useFieldArray } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Plus, X, GripVertical } from 'lucide-react'
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import { SortableContext, useSortable, arrayMove, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
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
import { ScrollArea } from '@/components/ui/scroll-area'
import { CUSTOM_FIELD_TYPES } from '@/lib/custom-fields/field-config'
import {
  createDefinition,
  updateDefinition,
  type CustomFieldDefinitionRow,
  type CreateDefinitionInput,
} from '@/app/(dashboard)/settings/custom-fields/actions'
import type { CustomFieldEntity, CustomFieldType } from '@/types/database'

// Client-side schema mirror — avoids importing the 'use server' schema object directly
// which causes type inference issues with zodResolver in Next.js build.
const clientValidationSchema = z.object({
  min: z.number().optional(),
  max: z.number().optional(),
  max_length: z.number().int().positive().optional(),
  pattern: z.string().optional(),
  currency_code: z.string().length(3).optional(),
}).nullable().optional()

const clientDefinitionSchema = z.object({
  entity: z.enum(['contact', 'opportunity', 'account'] as const),
  key: z.string().regex(/^[a-z][a-z0-9_]*$/),
  label: z.string().min(1).max(100),
  type: z.enum(CUSTOM_FIELD_TYPES),
  required: z.boolean(),
  unique_per_org: z.boolean(),
  visible_in_list: z.boolean(),
  filterable: z.boolean(),
  position: z.number().optional(),
  group_name: z.string().nullable().optional(),
  help_text: z.string().nullable().optional(),
  default_value: z.unknown().nullable().optional(),
  options: z.array(z.object({
    value: z.string().min(1),
    label: z.string().min(1),
    color: z.string().optional(),
  })).nullable().optional(),
  validation: clientValidationSchema,
})

type ClientDefinitionInput = z.infer<typeof clientDefinitionSchema>

const TYPE_LABELS: Record<CustomFieldType, string> = {
  text: 'Text',
  long_text: 'Long text',
  number: 'Number',
  integer: 'Integer',
  boolean: 'Boolean (Yes/No)',
  date: 'Date',
  datetime: 'Date & time',
  select: 'Single select',
  multi_select: 'Multi-select',
  url: 'URL',
  email: 'Email',
  phone: 'Phone',
  currency: 'Currency',
}

const OPTION_COLORS = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#3b82f6', '#8b5cf6']

interface DefinitionModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  entity: CustomFieldEntity
  definition?: CustomFieldDefinitionRow | null
}

interface OptionRowProps {
  id: string
  index: number
  value: string
  label: string
  color?: string
  onChange: (idx: number, field: 'value' | 'label' | 'color', v: string) => void
  onRemove: (idx: number) => void
}

function SortableOptionRow({ id, index, value, label, color, onChange, onRemove }: OptionRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id })
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 }

  return (
    <div ref={setNodeRef} style={style} className="flex items-center gap-2">
      <button {...attributes} {...listeners} className="cursor-grab text-muted-foreground">
        <GripVertical className="h-4 w-4" />
      </button>
      <Input
        placeholder="value"
        value={value}
        onChange={(e) => onChange(index, 'value', e.target.value)}
        className="h-7 text-xs font-mono w-28"
      />
      <Input
        placeholder="Label"
        value={label}
        onChange={(e) => onChange(index, 'label', e.target.value)}
        className="h-7 text-xs flex-1"
      />
      <div className="flex gap-1">
        {OPTION_COLORS.map((c) => (
          <button
            key={c}
            type="button"
            className="h-4 w-4 rounded-full border-2 transition-transform hover:scale-110"
            style={{
              backgroundColor: c,
              borderColor: color === c ? 'white' : 'transparent',
              outline: color === c ? `2px solid ${c}` : 'none',
            }}
            onClick={() => onChange(index, 'color', c)}
            aria-label={`Color ${c}`}
          />
        ))}
      </div>
      <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={() => onRemove(index)}>
        <X className="h-3.5 w-3.5" />
      </Button>
    </div>
  )
}

export function DefinitionModal({ open, onOpenChange, entity, definition }: DefinitionModalProps) {
  const isEditMode = !!definition?.id
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  const form = useForm<ClientDefinitionInput>({
    resolver: zodResolver(clientDefinitionSchema),
    defaultValues: {
      entity,
      required: false,
      unique_per_org: false,
      visible_in_list: false,
      filterable: false,
      key: '',
      label: '',
      type: 'text',
      options: [],
    },
  })

  const watchedType = form.watch('type')

  const { fields: optionFields, append, remove, move } = useFieldArray({
    control: form.control,
    name: 'options' as never,
  })

  useEffect(() => {
    if (!open) return
    if (isEditMode && definition) {
      form.reset({
        entity: definition.entity,
        key: definition.key,
        label: definition.label,
        type: definition.type,
        required: definition.required,
        unique_per_org: definition.unique_per_org,
        visible_in_list: definition.visible_in_list,
        filterable: definition.filterable,
        group_name: definition.group_name,
        help_text: definition.help_text,
        default_value: definition.default_value as string | null | undefined,
        options: (definition.options as Array<{ value: string; label: string; color?: string }> | null) ?? [],
        validation: definition.validation as Record<string, unknown> | null | undefined,
      })
    } else {
      form.reset({
        entity,
        required: false,
        unique_per_org: false,
        visible_in_list: false,
        filterable: false,
        key: '',
        label: '',
        type: 'text',
        options: [],
      })
    }
  }, [open, isEditMode, definition, entity, form])

  const optionSensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))

  function handleOptionDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIdx = optionFields.findIndex((f) => f.id === active.id)
    const newIdx = optionFields.findIndex((f) => f.id === over.id)
    move(oldIdx, newIdx)
  }

  function handleOptionChange(idx: number, field: 'value' | 'label' | 'color', v: string) {
    const current = form.getValues('options') as Array<{ value: string; label: string; color?: string }> ?? []
    const updated = [...current]
    updated[idx] = { ...updated[idx], [field]: v }
    form.setValue('options', updated as never)
  }

  async function onSubmit(data: ClientDefinitionInput) {
    startTransition(async () => {
      let result

      if (isEditMode && definition) {
        result = await updateDefinition({
          id: definition.id,
          label: data.label,
          required: data.required,
          unique_per_org: data.unique_per_org,
          visible_in_list: data.visible_in_list,
          filterable: data.filterable,
          group_name: data.group_name,
          help_text: data.help_text,
          default_value: data.default_value,
          options: data.options as Array<{ value: string; label: string; color?: string }> | null | undefined,
          validation: data.validation as Record<string, unknown> | null | undefined,
        })
      } else {
        result = await createDefinition(data as CreateDefinitionInput)
      }

      if (result.ok) {
        toast.success('Field saved')
        onOpenChange(false)
        router.refresh()
      } else {
        toast.error(result.error === 'reserved_key' ? 'That key is reserved by the system' : result.error)
      }
    })
  }

  const showOptionsEditor = watchedType === 'select' || watchedType === 'multi_select'
  const showCurrencyCode = watchedType === 'currency'
  const showMinMax = watchedType === 'number' || watchedType === 'integer'
  const showMaxLength = watchedType === 'text' || watchedType === 'long_text'

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEditMode ? 'Edit field' : 'New custom field'}</DialogTitle>
        </DialogHeader>

        <ScrollArea className="max-h-[60vh] pr-3">
          <Form {...form}>
            <form
              id="definition-form"
              onSubmit={form.handleSubmit(onSubmit)}
              className="space-y-4 py-1"
            >
              {/* Key — create only */}
              {!isEditMode && (
                <FormField
                  control={form.control}
                  name="key"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Field key</FormLabel>
                      <FormControl>
                        <Input placeholder="lead_score" {...field} />
                      </FormControl>
                      <p className="text-[11px] text-muted-foreground">Lowercase letters, numbers, underscores. Example: lead_score</p>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}

              {/* Label */}
              <FormField
                control={form.control}
                name="label"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Display label</FormLabel>
                    <FormControl>
                      <Input placeholder="Lead score" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Type */}
              {!isEditMode ? (
                <FormField
                  control={form.control}
                  name="type"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Type</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select a type" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {CUSTOM_FIELD_TYPES.map((t) => (
                            <SelectItem key={t} value={t}>{TYPE_LABELS[t]}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              ) : (
                <div className="space-y-1">
                  <Label className="text-sm font-medium">Type</Label>
                  <div className="flex items-center gap-2">
                    <Input value={TYPE_LABELS[definition!.type]} disabled className="bg-muted" />
                    <p className="text-[11px] text-muted-foreground whitespace-nowrap">Cannot be changed</p>
                  </div>
                </div>
              )}

              {/* Group */}
              <FormField
                control={form.control}
                name="group_name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Group <span className="text-muted-foreground font-normal">(optional)</span></FormLabel>
                    <FormControl>
                      <Input placeholder="Contact info" {...field} value={field.value ?? ''} />
                    </FormControl>
                    <p className="text-[11px] text-muted-foreground">Group this field with others under a shared heading</p>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Help text */}
              <FormField
                control={form.control}
                name="help_text"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Help text <span className="text-muted-foreground font-normal">(optional)</span></FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder="Shown below the input as a caption"
                        rows={2}
                        {...field}
                        value={field.value ?? ''}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Options editor for select/multi_select */}
              {showOptionsEditor && (
                <div className="space-y-2">
                  <Label className="text-sm font-medium">Options</Label>
                  <DndContext sensors={optionSensors} onDragEnd={handleOptionDragEnd}>
                    <SortableContext
                      items={optionFields.map((f) => f.id)}
                      strategy={verticalListSortingStrategy}
                    >
                      <div className="space-y-1.5">
                        {optionFields.map((field, idx) => (
                          <SortableOptionRow
                            key={field.id}
                            id={field.id}
                            index={idx}
                            value={(field as Record<string, string>).value ?? ''}
                            label={(field as Record<string, string>).label ?? ''}
                            color={(field as Record<string, string>).color}
                            onChange={handleOptionChange}
                            onRemove={remove}
                          />
                        ))}
                      </div>
                    </SortableContext>
                  </DndContext>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => append({ value: '', label: '' } as never)}
                  >
                    <Plus className="h-3.5 w-3.5 mr-1.5" />
                    Add option
                  </Button>
                </div>
              )}

              {/* Currency code */}
              {showCurrencyCode && (
                <FormField
                  control={form.control}
                  name="validation.currency_code"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Default currency code</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="USD"
                          maxLength={3}
                          className="uppercase w-24"
                          {...field}
                          value={field.value ?? ''}
                          onChange={(e) => field.onChange(e.target.value.toUpperCase())}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}

              {/* Number min/max */}
              {showMinMax && (
                <div className="grid grid-cols-2 gap-3">
                  <FormField
                    control={form.control}
                    name="validation.min"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Min value</FormLabel>
                        <FormControl>
                          <Input
                            type="number"
                            {...field}
                            value={field.value ?? ''}
                            onChange={(e) => field.onChange(e.target.value ? Number(e.target.value) : undefined)}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="validation.max"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Max value</FormLabel>
                        <FormControl>
                          <Input
                            type="number"
                            {...field}
                            value={field.value ?? ''}
                            onChange={(e) => field.onChange(e.target.value ? Number(e.target.value) : undefined)}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              )}

              {/* Text max_length */}
              {showMaxLength && (
                <FormField
                  control={form.control}
                  name="validation.max_length"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Max length</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          {...field}
                          value={field.value ?? ''}
                          onChange={(e) => field.onChange(e.target.value ? Number(e.target.value) : undefined)}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}

              {/* Toggles */}
              <div className="grid grid-cols-2 gap-3">
                {(
                  [
                    ['required', 'Required'],
                    ['unique_per_org', 'Unique per org'],
                    ['visible_in_list', 'Show in list view'],
                    ['filterable', 'Filterable'],
                  ] as const
                ).map(([fieldName, labelText]) => (
                  <FormField
                    key={fieldName}
                    control={form.control}
                    name={fieldName}
                    render={({ field }) => (
                      <FormItem className="flex items-center gap-2 space-y-0">
                        <FormControl>
                          <Switch checked={!!field.value} onCheckedChange={field.onChange} />
                        </FormControl>
                        <FormLabel className="font-normal cursor-pointer">{labelText}</FormLabel>
                      </FormItem>
                    )}
                  />
                ))}
              </div>

              {/* Default value */}
              <FormField
                control={form.control}
                name="default_value"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Default value <span className="text-muted-foreground font-normal">(optional)</span></FormLabel>
                    <FormControl>
                      <Input
                        placeholder="Leave blank for none"
                        {...field}
                        value={typeof field.value === 'string' ? field.value : ''}
                        onChange={(e) => field.onChange(e.target.value || null)}
                      />
                    </FormControl>
                    <p className="text-[11px] text-muted-foreground">For boolean: true/false. For select: the option value.</p>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </form>
          </Form>
        </ScrollArea>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>
            Cancel
          </Button>
          <Button type="submit" form="definition-form" disabled={isPending}>
            {isPending ? 'Saving…' : 'Save field'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
