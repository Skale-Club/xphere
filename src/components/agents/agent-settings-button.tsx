"use client";

import { Settings } from "lucide-react";

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
import type { AgentChannel } from "@/lib/agents/channels";

interface AgentSettingsButtonProps {
  defaults: Record<AgentChannel, string | null>;
  agents: Array<{ id: string; name: string; slug: string }>;
}

export function AgentSettingsButton({
  defaults,
  agents,
}: AgentSettingsButtonProps) {
  return (
    <Sheet>
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
        />
      </SheetContent>
    </Sheet>
  );
}
