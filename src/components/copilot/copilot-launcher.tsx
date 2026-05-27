"use client";

import { useEffect, useState } from "react";
import { CaretLeft, CaretRight, ChatCircle } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { useCopilotStore } from "@/stores/copilot-store";

const COLLAPSED_KEY = "copilot-launcher-collapsed";

export function CopilotShell() {
  const open = useCopilotStore((s) => s.open);
  const setOpen = useCopilotStore((s) => s.setOpen);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(COLLAPSED_KEY);
      if (stored !== null) {
        setCollapsed(stored === "1");
      } else {
        setCollapsed(window.innerWidth < 640);
      }
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
      <div className="group fixed bottom-0 -right-1 z-40 flex items-end justify-end pb-5 pl-12 pt-8">
        <div className="flex items-stretch">
          <button
            type="button"
            onClick={() => setCollapsed(false)}
            title="Expand launcher"
            aria-label="Expand Copilot launcher"
            className={cn(
              "flex w-5 items-center justify-center text-text-tertiary",
              "opacity-0 group-hover:opacity-100 hover:text-text-primary",
              "transition-opacity duration-150",
            )}
          >
            <CaretLeft size={16} weight="bold" />
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
            <ChatCircle size={20} weight="fill" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="group fixed bottom-0 right-0 z-40 flex items-end justify-end pb-5 pl-12 pt-8">
      <div className="flex items-center">
        <button
          type="button"
          onClick={() => { setOpen(true); setCollapsed(true); }}
          title="Open Copilot (⌘I)"
          aria-label="Open Copilot"
          className={cn(
            "flex items-center gap-2.5 rounded-2xl bg-accent px-4 py-3 text-white",
            "shadow-xl shadow-accent/30 transition-all hover:bg-accent-hover hover:shadow-accent/40 active:scale-[0.98]",
          )}
        >
          <ChatCircle size={20} weight="fill" className="shrink-0" />
          <span className="text-sm font-semibold tracking-tight">Copilot</span>
        </button>
        <div className="flex w-4 items-center justify-center sm:w-6 lg:w-8">
          <button
            type="button"
            onClick={() => setCollapsed(true)}
            title="Collapse launcher"
            aria-label="Collapse Copilot launcher"
            className={cn(
              "flex items-center justify-center text-text-tertiary transition-all hover:text-text-primary",
              "opacity-0 group-hover:opacity-100",
            )}
          >
            <CaretRight size={16} weight="bold" />
          </button>
        </div>
      </div>
    </div>
  );
}
