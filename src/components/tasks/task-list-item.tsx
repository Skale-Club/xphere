"use client";

import { useState } from "react";
import { format, parseISO } from "date-fns";
import { CheckCircle2, Circle, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import type { TaskRow, ContactOption } from "@/app/(dashboard)/tasks/actions";
import type { TaskPriority } from "@/types/database";
import { displayContactName } from "@/lib/contacts/names";

const PRIORITY_COLORS: Record<TaskPriority, string> = {
  low: "bg-zinc-500/15 text-zinc-400",
  medium: "bg-blue-500/15 text-blue-400",
  high: "bg-orange-500/15 text-orange-400",
  urgent: "bg-red-500/15 text-red-400",
};
const PRIORITY_LABELS: Record<TaskPriority, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  urgent: "Urgent",
};

const AVATAR_COLORS = [
  "bg-violet-500/20 text-violet-300",
  "bg-blue-500/20 text-blue-300",
  "bg-emerald-500/20 text-emerald-300",
  "bg-rose-500/20 text-rose-300",
  "bg-amber-500/20 text-amber-300",
  "bg-cyan-500/20 text-cyan-300",
];

function avatarColor(seed: string) {
  const h = seed.split("").reduce((a, c) => a + c.charCodeAt(0), 0);
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

function initials(name: string | null | undefined): string {
  if (!name?.trim()) return "?";
  const p = name.trim().split(/\s+/);
  return p.length === 1
    ? p[0][0].toUpperCase()
    : (p[0][0] + p[p.length - 1][0]).toUpperCase();
}

interface TaskListItemProps {
  task: TaskRow;
  contact: ContactOption | null;
  onToggle: (id: string) => void;
  onEdit: (task: TaskRow) => void;
  onDelete: (id: string) => void;
  isPending: boolean;
}

export function TaskListItem({
  task,
  contact,
  onToggle,
  onEdit,
  onDelete,
  isPending,
}: TaskListItemProps) {
  const done = task.status === "done";
  const contactName = contact
    ? displayContactName(contact, contact.phone ?? contact.email ?? "")
    : null;
  const [confirmOpen, setConfirmOpen] = useState(false);

  return (
    <>
      <div
        onClick={() => onEdit(task)}
        className={cn(
          "group flex items-start gap-3 px-4 py-3 hover:bg-white/4 cursor-pointer transition-colors",
          done && "opacity-50",
        )}
      >
        <button
          onClick={(e) => {
            e.stopPropagation();
            onToggle(task.id);
          }}
          disabled={isPending}
          aria-label={done ? "Mark todo" : "Mark done"}
          className="mt-0.5 shrink-0 text-muted-foreground hover:text-emerald-400 transition-colors"
        >
          {done ? (
            <CheckCircle2 className="h-4 w-4 text-emerald-400" />
          ) : (
            <Circle className="h-4 w-4" />
          )}
        </button>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className={cn(
                "text-sm font-medium text-foreground",
                done && "line-through text-muted-foreground",
              )}
            >
              {task.title}
            </span>
            <Badge
              variant="secondary"
              className={cn(
                "text-[10px] h-4 px-1.5",
                PRIORITY_COLORS[task.priority],
              )}
            >
              {PRIORITY_LABELS[task.priority]}
            </Badge>
          </div>
          {task.description && (
            <p className="text-xs text-muted-foreground truncate mt-0.5 max-w-sm">
              {task.description}
            </p>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0 ml-2">
          {contactName && (
            <div className="flex items-center gap-1.5">
              <span
                className={cn(
                  "inline-flex h-5 w-5 items-center justify-center rounded-full text-[0.6rem] font-semibold",
                  avatarColor(task.entity_id ?? contactName),
                )}
              >
                {initials(contactName)}
              </span>
              <span className="text-xs text-muted-foreground hidden sm:inline max-w-[80px] truncate">
                {contactName}
              </span>
            </div>
          )}
          {task.due_date && (
            <span className="text-xs text-muted-foreground tabular-nums">
              {format(parseISO(task.due_date), "h:mm a")}
            </span>
          )}
          <div
            className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
            onClick={(e) => e.stopPropagation()}
          >
            <Button
              size="icon"
              variant="ghost"
              className="h-6 w-6"
              onClick={() => onEdit(task)}
            >
              <Pencil className="h-3 w-3" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              className="h-6 w-6 text-red-400 hover:text-red-300"
              onClick={() => setConfirmOpen(true)}
              disabled={isPending}
            >
              <Trash2 className="h-3 w-3" />
            </Button>
          </div>
        </div>
      </div>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete task?</AlertDialogTitle>
            <AlertDialogDescription>
              &ldquo;{task.title}&rdquo; will be permanently deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700 text-white"
              onClick={() => onDelete(task.id)}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
