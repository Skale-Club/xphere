'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { savePlatformSetting } from '@/app/(dashboard)/settings/platform/actions'
import type { PlatformSettingEntry, PlatformKey } from '@/lib/platform-keys'
import { PLATFORM_TABS } from '@/lib/platform-keys'

interface PlatformSettingsFormProps {
  settings: PlatformSettingEntry[]
}

export function PlatformSettingsForm({ settings }: PlatformSettingsFormProps) {
  const [values, setValues] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState<Record<string, boolean>>({})

  async function handleSave(key: PlatformKey) {
    const value = values[key]?.trim()
    if (!value) {
      toast.error('Enter a value before saving.')
      return
    }

    setSaving((s) => ({ ...s, [key]: true }))
    const result = await savePlatformSetting(key, value)
    setSaving((s) => ({ ...s, [key]: false }))

    if (result.error) {
      toast.error(result.error)
    } else {
      toast.success('Setting saved.')
      setValues((v) => ({ ...v, [key]: '' }))
    }
  }

  const byTab = (tab: string) => settings.filter((s) => s.tab === tab)

  return (
    <Tabs defaultValue={PLATFORM_TABS[0]}>
      <TabsList className="mb-4">
        {PLATFORM_TABS.map((tab) => (
          <TabsTrigger key={tab} value={tab}>
            {tab}
          </TabsTrigger>
        ))}
      </TabsList>

      {PLATFORM_TABS.map((tab) => (
        <TabsContent key={tab} value={tab} className="space-y-4">
          {byTab(tab).map((setting) => (
            <Card key={setting.key}>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium">{setting.label}</CardTitle>
                <CardDescription className="text-xs">{setting.description}</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex items-end gap-2">
                  <div className="flex-1 space-y-1">
                    <Label htmlFor={setting.key} className="text-xs text-muted-foreground">
                      {setting.hint ? `Current: ${setting.hint}` : 'Not configured'}
                    </Label>
                    <Input
                      id={setting.key}
                      type="password"
                      placeholder="Enter new value"
                      value={values[setting.key] ?? ''}
                      onChange={(e) =>
                        setValues((v) => ({ ...v, [setting.key]: e.target.value }))
                      }
                      className="font-mono text-sm"
                    />
                  </div>
                  <Button
                    size="sm"
                    disabled={saving[setting.key] || !values[setting.key]?.trim()}
                    onClick={() => handleSave(setting.key as PlatformKey)}
                  >
                    {saving[setting.key] ? 'Saving…' : 'Save'}
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </TabsContent>
      ))}
    </Tabs>
  )
}
