"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import {
  AGENT_CHANNELS,
  AGENT_CHANNEL_LABELS,
  type AgentChannel,
} from "@/lib/agents/channels";
import { setChannelDefault } from "@/app/(dashboard)/agents/actions";
import { cn } from "@/lib/utils";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface ChannelDefaultsCardProps {
  defaults: Record<AgentChannel, string | null>;
  agents: Array<{ id: string; name: string; slug: string }>;
  surface?: "card" | "plain";
  focusChannel?: AgentChannel | null;
}

// Radix Select forbids `value=""` on items. We use a sentinel that the
// onValueChange handler maps to `null` before calling setChannelDefault.
const DEFAULT_SENTINEL = "__main_agent_default__";

export function ChannelDefaultsCard({
  defaults,
  agents,
  surface = "card",
  focusChannel = null,
}: ChannelDefaultsCardProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function handleChange(channel: AgentChannel, raw: string) {
    const next = raw === DEFAULT_SENTINEL ? null : raw;
    startTransition(async () => {
      const result = await setChannelDefault(channel, next);
      if (result && "error" in result && result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(
        next === null
          ? `${AGENT_CHANNEL_LABELS[channel]} bot disabled.`
          : `${AGENT_CHANNEL_LABELS[channel]} default updated.`,
      );
      router.refresh();
    });
  }

  const content = (
    <>
      <CardHeader className={surface === "plain" ? "px-0 pt-0" : undefined}>
        <CardTitle className="text-base">Channel Defaults</CardTitle>
        <CardDescription>
          Pick the default agent for each channel. Channels with no default keep
          automatic replies disabled.
        </CardDescription>
      </CardHeader>
      <CardContent className={surface === "plain" ? "px-0 pb-0" : undefined}>
        <div className="grid gap-3 sm:grid-cols-2">
          {AGENT_CHANNELS.map((ch) => {
            const currentId = defaults[ch];
            const selectValue = currentId ?? DEFAULT_SENTINEL;
            return (
              <div
                key={ch}
                className={cn(
                  "flex min-w-0 flex-col gap-2 rounded-md border bg-background/40 px-3 py-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3",
                  focusChannel === ch && "border-warning/40 bg-[var(--warning-muted)]",
                )}
              >
                <Label
                  htmlFor={`channel-default-${ch}`}
                  className="text-sm font-medium shrink-0"
                >
                  {AGENT_CHANNEL_LABELS[ch]}
                </Label>
                <Select
                  value={selectValue}
                  disabled={isPending}
                  onValueChange={(v) => handleChange(ch, v)}
                >
                  <SelectTrigger
                    id={`channel-default-${ch}`}
                    className="h-8 w-full min-w-0 text-xs sm:w-[220px]"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={DEFAULT_SENTINEL}>
                      No default (bot disabled)
                    </SelectItem>
                    {agents.map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            );
          })}
        </div>
      </CardContent>
    </>
  );

  if (surface === "plain") {
    return <div>{content}</div>;
  }

  return <Card>{content}</Card>;
}
