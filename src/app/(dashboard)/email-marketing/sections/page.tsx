'use client'

import { useState, useTransition, useEffect } from 'react'
import Link from 'next/link'
import { ArrowLeft, Plus, Trash2, Save, Globe, Lock } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from '@/components/ui/sheet'
import {
  getEmailSections,
  createEmailSection,
  updateEmailSection,
  deleteEmailSection,
  type EmailSectionRow,
} from '../_actions/sections'
import { PageContainer } from '@/components/layout/page-header'

const TYPES = ['header', 'footer', 'hero', 'cta', 'text', 'image', 'divider', 'social', 'custom'] as const

export default function EmailSectionsPage() {
  const [sections, setSections] = useState<EmailSectionRow[]>([])
  const [sheetOpen, setSheetOpen] = useState(false)
  const [editing, setEditing] = useState<EmailSectionRow | null>(null)
  const [isPending, startTransition] = useTransition()

  // Form state
  const [formName, setFormName] = useState('')
  const [formType, setFormType] = useState<string>('custom')
  const [formHtml, setFormHtml] = useState('')
  const [formGlobal, setFormGlobal] = useState(false)

  useEffect(() => {
    getEmailSections().then((r) => { if (r.ok) setSections(r.data) })
  }, [])

  function openCreate() {
    setEditing(null)
    setFormName(''); setFormType('custom'); setFormHtml(''); setFormGlobal(false)
    setSheetOpen(true)
  }

  function openEdit(s: EmailSectionRow) {
    setEditing(s)
    setFormName(s.name); setFormType(s.type); setFormHtml(s.html_content); setFormGlobal(s.is_global)
    setSheetOpen(true)
  }

  function handleSave() {
    startTransition(async () => {
      if (editing) {
        const r = await updateEmailSection(editing.id, {
          name: formName, type: formType as typeof TYPES[number], html_content: formHtml, is_global: formGlobal,
        })
        if (!r.ok) { toast.error(r.error); return }
        setSections((prev) => prev.map((s) => s.id === editing.id ? r.data : s))
        toast.success('Seção atualizada')
      } else {
        const r = await createEmailSection({
          name: formName, type: formType as typeof TYPES[number], html_content: formHtml, is_global: formGlobal,
        })
        if (!r.ok) { toast.error(r.error); return }
        setSections((prev) => [...prev, r.data])
        toast.success('Seção criada')
      }
      setSheetOpen(false)
    })
  }

  function handleDelete(id: string) {
    if (!confirm('Deletar esta seção?')) return
    startTransition(async () => {
      const r = await deleteEmailSection(id)
      if (!r.ok) { toast.error(r.error); return }
      setSections((prev) => prev.filter((s) => s.id !== id))
    })
  }

  const global = sections.filter((s) => s.is_global)
  const local = sections.filter((s) => !s.is_global)

  return (
    <PageContainer className="space-y-6">
      <Button asChild variant="ghost" size="sm">
        <Link href="/email-marketing"><ArrowLeft className="h-3.5 w-3.5 mr-1" /> Templates</Link>
      </Button>

      <div className="flex items-center justify-end">
        <Button size="sm" onClick={openCreate} className="gap-1.5">
          <Plus className="h-3.5 w-3.5" /> Nova seção
        </Button>
      </div>

      {sections.length === 0 && (
        <div className="rounded-lg border border-dashed border-border py-12 text-center text-sm text-muted-foreground">
          No global sections yet.
        </div>
      )}

      {global.length > 0 && (
        <SectionGroup title="Compartilhadas" sections={global} onEdit={openEdit} onDelete={handleDelete} />
      )}
      {local.length > 0 && (
        <SectionGroup title="Privadas" sections={local} onEdit={openEdit} onDelete={handleDelete} />
      )}

      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent side="right" className="w-full sm:max-w-lg overflow-y-auto">
          <SheetHeader className="mb-4">
            <SheetTitle>{editing ? 'Editar seção' : 'Nova seção'}</SheetTitle>
          </SheetHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Nome</Label>
              <Input value={formName} onChange={(e) => setFormName(e.target.value)} placeholder="ex: Header principal" />
            </div>
            <div className="space-y-1.5">
              <Label>Tipo</Label>
              <Select value={formType} onValueChange={setFormType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TYPES.map((t) => (
                    <SelectItem key={t} value={t} className="capitalize">{t}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>HTML</Label>
              <Textarea
                value={formHtml}
                onChange={(e) => setFormHtml(e.target.value)}
                rows={14}
                className="font-mono text-xs resize-none"
                placeholder="HTML email-safe (inline styles, table-based layout)…"
              />
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={formGlobal} onCheckedChange={setFormGlobal} id="global-switch" />
              <Label htmlFor="global-switch" className="cursor-pointer">
                Seção compartilhada (aparece na biblioteca)
              </Label>
            </div>
            <Button className="w-full gap-1.5" onClick={handleSave} disabled={isPending || !formName.trim()}>
              <Save className="h-3.5 w-3.5" /> Salvar
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </PageContainer>
  )
}

function SectionGroup({
  title, sections, onEdit, onDelete,
}: {
  title: string
  sections: EmailSectionRow[]
  onEdit: (s: EmailSectionRow) => void
  onDelete: (id: string) => void
}) {
  return (
    <div className="space-y-2">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{title}</h2>
      <div className="divide-y divide-border rounded-lg border border-border overflow-hidden">
        {sections.map((s) => (
          <div key={s.id} className="flex items-center gap-3 px-4 py-3 bg-card hover:bg-muted/30">
            <Badge variant="outline" className="text-[10px] capitalize shrink-0">{s.type}</Badge>
            <span className="flex-1 text-sm font-medium truncate">{s.name}</span>
            {s.is_global ? (
              <Globe className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            ) : (
              <Lock className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            )}
            <Button size="sm" variant="ghost" onClick={() => onEdit(s)}>Editar</Button>
            <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => onDelete(s.id)}>
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        ))}
      </div>
    </div>
  )
}
