"use client";

import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, MessageCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCopilotStore } from "@/stores/copilot-store";

const COLLAPSED_KEY = "copilot-launcher-collapsed";

export function CopilotShell() {
  const open = useCopilotStore((s) => s.open);
  const setOpen = useCopilotStore((s) => s.setOpen);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    try {
      setCollapsed(window.localStorage.getItem(COLLAPSED_KEY) === "1");
    } catch {
      // ignore (SSR / disabled storage)
    }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(COLLAPSED_KEY, collapsed ? "1" : "0");
    } catch {
      // ignore
    }
  }, [collapsed]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && (e.key === "i" || e.key === "I")) {
        e.preventDefault();
        setOpen(!open);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, setOpen]);

  // While the panel is open, the panel itself is the affordance | hide launcher.
  if (open) return null;

  if (collapsed) {
    return (
      <div className="group fixed bottom-5 right-0 z-40 flex items-stretch">
        <button
          type="button"
          onClick={() => setCollapsed(false)}
          title="Expand launcher"
          aria-label="Expand Copilot launcher"
          className={cn(
            "flex w-4 items-center justify-center rounded-l-md bg-bg-tertiary/80 text-text-tertiary",
            "opacity-0 group-hover:opacity-100 hover:bg-bg-tertiary hover:text-text-primary",
            "transition-opacity duration-150",
          )}
        >
          <ChevronLeft className="h-3 w-3" />
        </button>
        <button
          type="button"
          onClick={() => setOpen(true)}
          title="Open Copilot (⌘I)"
          aria-label="Open Copilot"
          className={cn(
            "flex h-11 w-11 items-center justify-center rounded-l-2xl bg-accent text-white",
            "shadow-xl shadow-accent/30 transition-all hover:bg-accent-hover hover:shadow-accent/40 active:scale-[0.98]",
          )}
        >
          <MessageCircle
            className="h-5 w-5 fill-white/20"
            strokeWidth={1.8}
          />
        </button>
      </div>
    );
  }

  return (
    <div className="fixed bottom-5 right-5 z-40 flex items-stretch">
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Open Copilot (⌘I)"
        aria-label="Open Copilot"
        className={cn(
          "flex items-center gap-2.5 rounded-l-2xl bg-accent pl-4 pr-3 py-3 text-white",
          "shadow-xl shadow-accent/30 transition-all hover:bg-accent-hover hover:shadow-accent/40 active:scale-[0.98]",
        )}
      >
        <MessageCircle
          className="h-5 w-5 shrink-0 fill-white/20"
          strokeWidth={1.8}
        />
        <span className="text-sm font-semibold tracking-tight">Copilot</span>
      </button>
      <button
        type="button"
        onClick={() => setCollapsed(true)}
        title="Collapse launcher"
        aria-label="Collapse Copilot launcher"
        className={cn(
          "flex w-6 items-center justify-center rounded-r-2xl bg-accent text-white/70",
          "shadow-xl shadow-accent/30 transition-all hover:bg-accent-hover hover:text-white hover:shadow-accent/40 active:scale-[0.98]",
          "border-l border-white/15",
        )}
      >
        <ChevronRight className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
