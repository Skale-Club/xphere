"use client";

import { useEffect, useMemo, useState } from "react";
import { Settings } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";

import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { ChannelDefaultsCard } from "@/components/agents/channel-defaults-card";
import { AGENT_CHANNELS, type AgentChannel } from "@/lib/agents/channels";

interface AgentSettingsButtonProps {
  defaults: Record<AgentChannel, string | null>;
  agents: Array<{ id: string; name: string; slug: string }>;
}

export function AgentSettingsButton({
  defaults,
  agents,
}: AgentSettingsButtonProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [open, setOpen] = useState(false);

  const focusChannel = useMemo(() => {
    const raw = searchParams.get("channel");
    return AGENT_CHANNELS.includes(raw as AgentChannel)
      ? (raw as AgentChannel)
      : null;
  }, [searchParams]);

  useEffect(() => {
    if (searchParams.get("settings") === "channels") {
      setOpen(true);
    }
  }, [searchParams]);

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next && searchParams.get("settings") === "channels") {
      const params = new URLSearchParams(searchParams.toString());
      params.delete("settings");
      params.delete("channel");
      const qs = params.toString();
      router.replace(qs ? `/agents?${qs}` : "/agents", { scroll: false });
    }
  }

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetTrigger asChild>
        <Button variant="secondary" size="sm" className="h-8">
          <Settings className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Settings</span>
        </Button>
      </SheetTrigger>
      <SheetContent
        side="right"
        className="w-full overflow-y-auto sm:max-w-2xl"
      >
        <SheetHeader className="pb-5 pr-8">
          <SheetTitle>Agent settings</SheetTitle>
          <SheetDescription>
            Manage defaults that apply across channels.
          </SheetDescription>
        </SheetHeader>

        <ChannelDefaultsCard
          defaults={defaults}
          agents={agents}
          surface="plain"
          focusChannel={focusChannel}
        />
      </SheetContent>
    </Sheet>
  );
}
