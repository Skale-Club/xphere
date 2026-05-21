'use client'

import { useFormContext, Controller } from 'react-hook-form'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { AGENT_CHANNEL_LABELS, type AgentChannel } from '@/lib/agents/channels'
import { AVAILABLE_MODELS } from '@/lib/agents/models'
import type { AgentFormInput } from '@/lib/agents/zod-schemas'

interface ChannelOverridesEditorProps {
  allowedChannels: AgentChannel[]
}

/**
 * Per-channel structured override editor (D-36-03).
 * One card per channel in `allowed_channels`. Empty fields stay undefined so
 * `channelOverrideSchema.transform()` strips them before save | the runtime
 * then falls back to base agent values.
 */
export function ChannelOverridesEditor({
  allowedChannels,
}: ChannelOverridesEditorProps) {
  const { register, control } = useFormContext<AgentFormInput>()

  if (allowedChannels.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Select at least one channel under &quot;Allowed channels&quot; to
        configure overrides.
      </p>
    )
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        Empty fields fall back to the base agent values. Only filled fields
        are persisted.
      </p>
      {allowedChannels.map((ch) => (
        <Card key={ch}>
          <CardHeader className="py-3">
            <CardTitle className="text-sm">
              {AGENT_CHANNEL_LABELS[ch]}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <Label>System prompt suffix</Label>
              <Textarea
                rows={2}
                {...register(
                  `channel_overrides.${ch}.system_prompt_suffix` as const
                )}
                placeholder="Appended to base prompt (leave empty to skip)"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Model</Label>
                <Controller
                  control={control}
                  name={`channel_overrides.${ch}.model` as const}
                  render={({ field }) => (
                    <Select
                      onValueChange={(v) =>
                        field.onChange(v === '__base__' ? undefined : v)
                      }
                      value={field.value ?? '__base__'}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__base__">Use base model</SelectItem>
                        {AVAILABLE_MODELS.map((m) => (
                          <SelectItem key={m} value={m}>
                            {m}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
              </div>
              <div>
                <Label>Temperature</Label>
                <Input
                  type="number"
                  step="0.1"
                  min="0"
                  max="2"
                  {...register(
                    `channel_overrides.${ch}.temperature` as const,
                    {
                      setValueAs: (v) =>
                        v === '' || v == null ? undefined : Number(v),
                    }
                  )}
                  placeholder="0-2"
                />
              </div>
              <div>
                <Label>Max tokens</Label>
                <Input
                  type="number"
                  min="1"
                  {...register(`channel_overrides.${ch}.max_tokens` as const, {
                    setValueAs: (v) =>
                      v === '' || v == null ? undefined : Number(v),
                  })}
                  placeholder="Default"
                />
              </div>
              <div>
                <Label>Max history</Label>
                <Input
                  type="number"
                  min="1"
                  {...register(`channel_overrides.${ch}.max_history` as const, {
                    setValueAs: (v) =>
                      v === '' || v == null ? undefined : Number(v),
                  })}
                  placeholder="Default"
                />
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
