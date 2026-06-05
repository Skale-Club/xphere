"use client";

// R08: space-aware list for the Projects module.
// Ported from src/components/workflows/workflows-list.tsx with:
//   - Trigger column / WorkflowToggle / TRIGGER_META removed (projects have no triggers).
//   - Row layout reduced to NAME / STATUS / UPDATED columns.
//   - TouchSensor added alongside PointerSensor (P11 mobile polish).
//
// Drag-and-drop:
//   - Drag a project row to reorder it within a group.
//   - Drag a project row onto another group (space header, empty space, or
//     any row inside it) to move it there.
//   - Drag a space header to reorder spaces amongst themselves.

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useTransition,
} from "react";
import Link from "next/link";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import {
  ChevronRight,
  Folder as FolderIcon,
  FolderOpen,
  FolderKanban,
  MoreHorizontal,
  Archive,
  ArchiveRestore,
  Trash2,
  FolderInput,
  Pencil,
  GripVertical,
} from "lucide-react";
import { formatDistanceToNow, parseISO } from "date-fns";
import { toast } from "sonner";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  useDroppable,
  pointerWithin,
  rectIntersection,
  getFirstCollision,
  type CollisionDetection,
  type DragStartEvent,
  type DragEndEvent,
  type DragOverEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { NewProjectDialog } from "@/components/projects/new-project-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
  DropdownMenuPortal,
} from "@/components/ui/dropdown-menu";

import {
  archiveProject,
  moveProjectToSpace,
  reorderProjectsInSpace,
  softDeleteProject,
  unarchiveProject,
} from "@/app/(dashboard)/projects/actions";
import {
  deleteSpace,
  renameSpace,
  reorderSpaces,
} from "@/app/(dashboard)/projects/_actions/spaces";

const UNFILED_ID = "__unfiled__";

interface ProjectSummary {
  id: string;
  name: string;
  description: string | null;
  color: string | null;
  space_id: string | null;
  archived_at: string | null;
  updated_at: string;
}

interface ProjectSpace {
  id: string;
  org_id: string;
  name: string;
  color: string | null;
  icon: string | null;
  parent_id: string | null;
  position: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

interface Props {
  projects: ProjectSummary[];
  spaces?: ProjectSpace[];
}

type DragData =
  | { type: "project"; spaceId: string | null }
  | { type: "space"; spaceId: string | null };

export function ProjectsListFolders({ projects, spaces = [] }: Props) {
  const router = useRouter();

  // Optimistic local state — drag-and-drop should feel instant.
  const [localProjects, setLocalProjects] = useState(projects);
  const [localSpaces, setLocalSpaces] = useState(spaces);
  useEffect(() => setLocalProjects(projects), [projects]);
  useEffect(() => setLocalSpaces(spaces), [spaces]);

  const [activeId, setActiveId] = useState<string | null>(null);
  const [activeType, setActiveType] = useState<"project" | "space" | null>(
    null,
  );
  const [overGroupId, setOverGroupId] = useState<string | null>(null);

  // Wider distance so clicks register as clicks, not drags.
  // TouchSensor preserves mobile drag (P11).
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 250, tolerance: 8 },
    }),
  );

  const collisionDetectionStrategy: CollisionDetection = useCallback((args) => {
    const pointerCollisions = pointerWithin(args);
    if (pointerCollisions.length > 0) {
      const firstId = getFirstCollision(pointerCollisions, "id");
      if (firstId != null) {
        return pointerCollisions.filter((c) => c.id === firstId);
      }
      return pointerCollisions;
    }
    return rectIntersection(args);
  }, []);

  const groups = useMemo(() => {
    const bySpace = new Map<string | null, ProjectSummary[]>();
    bySpace.set(null, []);
    for (const f of localSpaces) bySpace.set(f.id, []);
    for (const p of localProjects) {
      const key = p.space_id ?? null;
      if (!bySpace.has(key)) bySpace.set(key, []);
      bySpace.get(key)!.push(p);
    }
    return bySpace;
  }, [localProjects, localSpaces]);

  const unfiled = groups.get(null) ?? [];

  const activeProject =
    activeType === "project" && activeId
      ? (localProjects.find((p) => p.id === activeId) ?? null)
      : null;
  const activeSpace =
    activeType === "space" && activeId
      ? (localSpaces.find((f) => f.id === activeId) ?? null)
      : null;

  function handleDragStart(event: DragStartEvent) {
    const data = event.active.data.current as DragData | undefined;
    setActiveId(String(event.active.id));
    setActiveType(data?.type ?? null);
  }

  function handleDragOver(event: DragOverEvent) {
    const { over } = event;
    if (!over) return setOverGroupId(null);
    const overData = over.data.current as
      | { type?: string; spaceId?: string | null }
      | undefined;
    if (overData?.type === "space" || overData?.type === "project") {
      const fid = overData.spaceId ?? null;
      setOverGroupId(fid === null ? UNFILED_ID : String(fid));
    } else {
      setOverGroupId(null);
    }
  }

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    const activeData = active.data.current as DragData | undefined;
    const overData = over?.data.current as
      | { type?: string; spaceId?: string | null }
      | undefined;
    setActiveId(null);
    setActiveType(null);
    setOverGroupId(null);
    if (!over || !activeData) return;

    // ─── Space reorder ─────────────────────────────────────────────────────
    if (activeData.type === "space") {
      if (overData?.type !== "space") return;
      if (over.id === active.id) return;
      const oldIndex = localSpaces.findIndex((f) => f.id === active.id);
      const newIndex = localSpaces.findIndex((f) => f.id === over.id);
      if (oldIndex < 0 || newIndex < 0) return;
      const newOrder = arrayMove(localSpaces, oldIndex, newIndex);
      setLocalSpaces(newOrder);
      const res = await reorderSpaces(newOrder.map((f) => f.id));
      if (!res.ok) {
        toast.error(res.error);
        setLocalSpaces(spaces);
        return;
      }
      router.refresh();
      return;
    }

    // ─── Project drag (reorder or move to a space) ─────────────────────────
    if (activeData.type === "project") {
      const project = localProjects.find((p) => p.id === active.id);
      if (!project) return;

      // Resolve target space from whatever we landed on.
      let targetSpaceId: string | null;
      if (overData?.type === "project" || overData?.type === "space") {
        targetSpaceId = overData.spaceId ?? null;
      } else {
        return;
      }

      const sourceSpaceId = project.space_id ?? null;

      // Build the new ordered ID list for the target space.
      const targetList = (groups.get(targetSpaceId) ?? []).filter(
        (p) => p.id !== project.id,
      );
      let insertIndex = targetList.length;
      if (overData?.type === "project" && over.id !== active.id) {
        const idx = targetList.findIndex((p) => p.id === over.id);
        if (idx >= 0) insertIndex = idx;
      }
      const newTargetIds = [
        ...targetList.slice(0, insertIndex).map((p) => p.id),
        project.id,
        ...targetList.slice(insertIndex).map((p) => p.id),
      ];

      // Skip no-op within same space.
      if (sourceSpaceId === targetSpaceId) {
        const currentIds = (groups.get(sourceSpaceId) ?? []).map((p) => p.id);
        const sameOrder =
          currentIds.length === newTargetIds.length &&
          currentIds.every((id, i) => id === newTargetIds[i]);
        if (sameOrder) return;
      }

      // Optimistic local update.
      setLocalProjects((prev) => {
        const updated = prev.map((p) =>
          p.id === project.id ? { ...p, space_id: targetSpaceId } : p,
        );
        const idToProject = new Map(updated.map((p) => [p.id, p]));
        const inTarget = newTargetIds
          .map((id) => idToProject.get(id))
          .filter(Boolean) as ProjectSummary[];
        const others = updated.filter(
          (p) => (p.space_id ?? null) !== targetSpaceId,
        );
        return [...others, ...inTarget];
      });

      // Persist: re-parent first (if needed), then write positions.
      if (sourceSpaceId !== targetSpaceId) {
        const moveRes = await moveProjectToSpace(project.id, targetSpaceId);
        if (!moveRes.ok) {
          toast.error(moveRes.error);
          setLocalProjects(projects);
          return;
        }
      }
      const reorderRes = await reorderProjectsInSpace(
        targetSpaceId,
        newTargetIds,
      );
      if (!reorderRes.ok) {
        toast.error(reorderRes.error);
        setLocalProjects(projects);
        return;
      }
      router.refresh();
    }
  }

  if (localProjects.length === 0 && localSpaces.length === 0) {
    return (
      <Card>
        <CardContent className="p-12 text-center">
          <FolderKanban className="mx-auto h-8 w-8 text-text-tertiary mb-3" />
          <p className="text-sm font-medium text-text-primary mb-1">
            You don&apos;t have any projects yet
          </p>
          <p className="text-sm text-text-secondary mb-4">
            Create your first project to start organizing tasks.
          </p>
          <div className="inline-block">
            <NewProjectDialog>
              <Button size="sm">Create project</Button>
            </NewProjectDialog>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisionDetectionStrategy}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
    >
      <div className="space-y-3">
        {/* Unfoldered bucket — only render when it has rows */}
        {unfiled.length > 0 && (
          <UnfiledGroup
            projects={unfiled}
            spaces={localSpaces}
            isOver={overGroupId === UNFILED_ID}
          />
        )}

        <SortableContext
          items={localSpaces.map((f) => f.id)}
          strategy={verticalListSortingStrategy}
        >
          {localSpaces.map((space) => (
            <SpaceGroup
              key={space.id}
              space={space}
              projects={groups.get(space.id) ?? []}
              spaces={localSpaces}
              isOver={overGroupId === space.id}
            />
          ))}
        </SortableContext>
      </div>

      {typeof document !== "undefined" &&
        createPortal(
          <DragOverlay
            dropAnimation={{
              duration: 220,
              easing: "cubic-bezier(0.18, 0.89, 0.32, 1.28)",
            }}
          >
            {activeProject ? (
              <ProjectDragPreview project={activeProject} />
            ) : activeSpace ? (
              <SpaceDragPreview space={activeSpace} />
            ) : null}
          </DragOverlay>,
          document.body,
        )}
    </DndContext>
  );
}

// ─── Unfiled (non-reorderable) group ───────────────────────────────────────

function UnfiledGroup({
  projects,
  spaces,
  isOver,
}: {
  projects: ProjectSummary[];
  spaces: ProjectSpace[];
  isOver: boolean;
}) {
  const [open, setOpen] = useState(true);
  const { setNodeRef } = useDroppable({
    id: UNFILED_ID,
    data: { type: "space", spaceId: null },
  });

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "rounded-lg border bg-bg-secondary/30 overflow-hidden transition-colors",
        isOver ? "border-accent/60 bg-accent-muted/10" : "border-border-subtle",
      )}
    >
      <div className="flex items-center justify-between px-3 py-2 bg-bg-secondary/60 border-b border-border-subtle">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-2 text-left flex-1 min-w-0"
        >
          <ChevronRight
            className={`h-3.5 w-3.5 text-text-tertiary transition-transform ${
              open ? "rotate-90" : ""
            }`}
          />
          <span className="text-xs font-medium uppercase tracking-wide text-text-secondary truncate">
            Unfiled
          </span>
          <span className="inline-flex items-center justify-center min-w-[20px] h-[18px] px-1.5 rounded-full bg-bg-tertiary text-[10px] font-semibold text-text-tertiary tabular-nums">
            {projects.length}
          </span>
        </button>
      </div>

      {open && (
        <GroupBody
          projects={projects}
          spaces={spaces}
          spaceId={null}
          emptyLabel="No projects."
          isOver={isOver}
        />
      )}
    </div>
  );
}

// ─── Space group (sortable + droppable) ────────────────────────────────────

function SpaceGroup({
  space,
  projects,
  spaces,
  isOver,
}: {
  space: ProjectSpace;
  projects: ProjectSummary[];
  spaces: ProjectSpace[];
  isOver: boolean;
}) {
  const [open, setOpen] = useState(true);
  const [renameOpen, setRenameOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const {
    setNodeRef,
    attributes,
    listeners,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: space.id,
    data: { type: "space", spaceId: space.id },
  });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "rounded-lg border bg-bg-secondary/30 overflow-hidden transition-colors",
        isDragging && "opacity-40",
        isOver ? "border-accent/60 bg-accent-muted/10" : "border-border-subtle",
      )}
    >
      <div className="flex items-center justify-between px-3 py-2 bg-bg-secondary/60 border-b border-border-subtle">
        <div className="flex items-center gap-1.5 flex-1 min-w-0">
          <button
            type="button"
            {...attributes}
            {...listeners}
            className="flex h-6 w-5 items-center justify-center text-text-tertiary hover:text-text-secondary cursor-grab active:cursor-grabbing"
            aria-label="Drag space"
          >
            <GripVertical className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="flex items-center gap-2 text-left flex-1 min-w-0"
          >
            <ChevronRight
              className={`h-3.5 w-3.5 text-text-tertiary transition-transform ${
                open ? "rotate-90" : ""
              }`}
            />
            {open ? (
              <FolderOpen className="h-4 w-4 text-amber-500" />
            ) : (
              <FolderIcon className="h-4 w-4 text-amber-500" />
            )}
            <span className="text-xs font-medium uppercase tracking-wide text-text-secondary truncate">
              {space.name}
            </span>
            <span className="inline-flex items-center justify-center min-w-[20px] h-[18px] px-1.5 rounded-full bg-bg-tertiary text-[10px] font-semibold text-text-tertiary tabular-nums">
              {projects.length}
            </span>
          </button>
        </div>

        <SpaceMenu
          onRename={() => setRenameOpen(true)}
          onDelete={() => setDeleteOpen(true)}
        />
      </div>

      {open && (
        <GroupBody
          projects={projects}
          spaces={spaces}
          spaceId={space.id}
          emptyLabel="Empty space. Drop a project here or use the row menu."
          isOver={isOver}
        />
      )}

      <RenameSpaceDialog
        open={renameOpen}
        onOpenChange={setRenameOpen}
        space={space}
      />
      <DeleteSpaceDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        space={space}
        projectCount={projects.length}
      />
    </div>
  );
}

// ─── Group body (table of sortable rows, or empty state) ───────────────────

function GroupBody({
  projects,
  spaces,
  spaceId,
  emptyLabel,
  isOver,
}: {
  projects: ProjectSummary[];
  spaces: ProjectSpace[];
  spaceId: string | null;
  emptyLabel: string;
  isOver: boolean;
}) {
  if (projects.length === 0) {
    return (
      <div
        className={cn(
          "px-4 py-6 text-center text-xs transition-colors",
          isOver ? "text-accent" : "text-text-tertiary",
        )}
      >
        {emptyLabel}
      </div>
    );
  }
  return (
    <SortableContext
      items={projects.map((p) => p.id)}
      strategy={verticalListSortingStrategy}
    >
      <div className="w-full text-sm">
        <div className="hidden items-center gap-2 bg-bg-secondary/40 px-1 py-2 text-xs text-text-tertiary uppercase tracking-wide lg:grid lg:grid-cols-[32px_minmax(0,1fr)_96px_120px_36px]">
          <div />
          <div className="font-medium lg:px-4">Name</div>
          <div className="font-medium lg:px-4">Status</div>
          <div className="hidden text-right font-medium lg:block lg:px-4">
            Updated
          </div>
          <div />
        </div>
        <div className="divide-y divide-border-subtle">
          {projects.map((p) => (
            <SortableProjectRow
              key={p.id}
              project={p}
              spaces={spaces}
              spaceId={spaceId}
            />
          ))}
        </div>
      </div>
    </SortableContext>
  );
}

// ─── Row ────────────────────────────────────────────────────────────────────

interface RowProps {
  project: ProjectSummary;
  spaces: ProjectSpace[];
  spaceId: string | null;
}

function SortableProjectRow({ project: p, spaces, spaceId }: RowProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [confirmDelete, setConfirmDelete] = useState(false);

  const {
    setNodeRef,
    attributes,
    listeners,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: p.id,
    data: { type: "project", spaceId },
  });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  function handleMove(targetSpaceId: string | null) {
    startTransition(async () => {
      const res = await moveProjectToSpace(p.id, targetSpaceId);
      if (!res.ok) {
        toast.error(`Could not move project: ${res.error}`);
        return;
      }
      toast.success(
        targetSpaceId
          ? `Moved "${p.name}" to space.`
          : `Moved "${p.name}" out of its space.`,
      );
      router.refresh();
    });
  }

  function handleArchive() {
    startTransition(async () => {
      const res = p.archived_at
        ? await unarchiveProject(p.id)
        : await archiveProject(p.id);
      if (!res.ok) {
        toast.error(res.error ?? "Could not update project.");
        return;
      }
      toast.success(
        p.archived_at ? `Unarchived "${p.name}".` : `Archived "${p.name}".`,
      );
      router.refresh();
    });
  }

  function handleSoftDelete() {
    startTransition(async () => {
      const res = await softDeleteProject(p.id);
      if (!res.ok) {
        toast.error(res.error ?? "Could not move project to trash.");
        return;
      }
      toast.success(`Moved "${p.name}" to trash.`);
      setConfirmDelete(false);
      router.refresh();
    });
  }

  const currentSpaceId = p.space_id ?? null;
  const isArchived = !!p.archived_at;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "flex items-center gap-2 px-3 py-3 transition-colors hover:bg-bg-secondary/40 lg:grid lg:grid-cols-[32px_minmax(0,1fr)_96px_120px_36px] lg:px-1",
        isDragging && "opacity-40",
        isArchived && "opacity-60",
      )}
    >
      <div className="shrink-0">
        <button
          type="button"
          {...attributes}
          {...listeners}
          className="flex h-7 w-7 items-center justify-center text-text-tertiary hover:text-text-secondary cursor-grab active:cursor-grabbing"
          aria-label="Drag project"
        >
          <GripVertical className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="min-w-0 flex-1 lg:px-4">
        <Link href={`/projects/${p.id}`} className="block group">
          <div className="flex items-center gap-2 min-w-0">
            <span
              className="inline-block h-3 w-3 rounded-full shrink-0"
              style={{ backgroundColor: p.color ?? "#6366f1" }}
            />
            <p className="text-sm font-medium text-text-primary group-hover:underline truncate">
              {p.name}
            </p>
          </div>
          {p.description && (
            <p className="text-[11px] text-text-tertiary mt-0.5 line-clamp-1 ml-5">
              {p.description}
            </p>
          )}
        </Link>
      </div>
      <div className="shrink-0 lg:px-4">
        {isArchived ? (
          <span className="inline-flex items-center gap-1 text-[11px] text-text-tertiary">
            <Archive className="h-3 w-3" />
            Archived
          </span>
        ) : (
          <span className="inline-flex items-center text-[11px] text-text-tertiary">
            Active
          </span>
        )}
      </div>
      <div className="hidden px-4 py-3 text-right text-[11px] text-text-tertiary tabular-nums lg:block">
        {formatDistanceToNow(parseISO(p.updated_at), { addSuffix: true })}
      </div>
      <div className="shrink-0 text-right">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0"
              aria-label="Project actions"
              disabled={isPending}
            >
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <FolderInput className="h-3.5 w-3.5" />
                <span>Move to space</span>
              </DropdownMenuSubTrigger>
              <DropdownMenuPortal>
                <DropdownMenuSubContent className="w-56">
                  <DropdownMenuItem
                    disabled={currentSpaceId === null}
                    onSelect={() => handleMove(null)}
                  >
                    <FolderIcon className="h-3.5 w-3.5 opacity-50" />
                    <span>(no space)</span>
                  </DropdownMenuItem>
                  {spaces.length > 0 && <DropdownMenuSeparator />}
                  {spaces.map((f) => (
                    <DropdownMenuItem
                      key={f.id}
                      disabled={currentSpaceId === f.id}
                      onSelect={() => handleMove(f.id)}
                    >
                      <FolderIcon className="h-3.5 w-3.5 text-amber-500" />
                      <span className="truncate">{f.name}</span>
                    </DropdownMenuItem>
                  ))}
                  {spaces.length === 0 && (
                    <DropdownMenuItem disabled>
                      <span className="text-text-tertiary">No spaces yet</span>
                    </DropdownMenuItem>
                  )}
                </DropdownMenuSubContent>
              </DropdownMenuPortal>
            </DropdownMenuSub>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={handleArchive}>
              {isArchived ? (
                <>
                  <ArchiveRestore className="h-3.5 w-3.5" />
                  <span>Unarchive</span>
                </>
              ) : (
                <>
                  <Archive className="h-3.5 w-3.5" />
                  <span>Archive</span>
                </>
              )}
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={(e) => {
                e.preventDefault();
                setConfirmDelete(true);
              }}
              className="text-rose-500 focus:text-rose-500"
            >
              <Trash2 className="h-3.5 w-3.5" />
              <span>Move to trash</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Move project to trash?</AlertDialogTitle>
              <AlertDialogDescription>
                &ldquo;{p.name}&rdquo; will be moved to the Trash. You can
                restore it from there until it&rsquo;s permanently deleted.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={isPending}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                disabled={isPending}
                onClick={(e) => {
                  e.preventDefault();
                  handleSoftDelete();
                }}
                className="bg-rose-500 text-white hover:bg-rose-600"
              >
                Move to trash
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
}

// ─── Drag overlays ─────────────────────────────────────────────────────────

function ProjectDragPreview({ project }: { project: ProjectSummary }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border-subtle bg-bg-primary shadow-lg px-4 py-2.5">
      <GripVertical className="h-3.5 w-3.5 text-text-tertiary" />
      <span
        className="inline-block h-3 w-3 rounded-full shrink-0"
        style={{ backgroundColor: project.color ?? "#6366f1" }}
      />
      <span className="text-sm font-medium text-text-primary truncate max-w-[280px]">
        {project.name}
      </span>
    </div>
  );
}

function SpaceDragPreview({ space }: { space: ProjectSpace }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-border-subtle bg-bg-primary shadow-lg px-3 py-2">
      <GripVertical className="h-3.5 w-3.5 text-text-tertiary" />
      <FolderIcon className="h-4 w-4 text-amber-500" />
      <span className="text-xs font-medium uppercase tracking-wide text-text-secondary truncate max-w-[260px]">
        {space.name}
      </span>
    </div>
  );
}

// ─── Space menu (header) ────────────────────────────────────────────────────

interface SpaceMenuProps {
  onRename: () => void;
  onDelete: () => void;
}

function SpaceMenu({ onRename, onDelete }: SpaceMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0"
          aria-label="Space actions"
        >
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-40">
        <DropdownMenuItem onSelect={onRename}>
          <Pencil className="h-3.5 w-3.5" />
          <span>Rename</span>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={(e) => {
            e.preventDefault();
            onDelete();
          }}
          className="text-rose-500 focus:text-rose-500"
        >
          <Trash2 className="h-3.5 w-3.5" />
          <span>Delete</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ─── Rename space dialog ───────────────────────────────────────────────────

function RenameSpaceDialog({
  open,
  onOpenChange,
  space,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  space: ProjectSpace;
}) {
  const router = useRouter();
  const [name, setName] = useState(space.name);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error("Space name is required.");
      return;
    }
    if (trimmed === space.name) {
      onOpenChange(false);
      return;
    }
    startTransition(async () => {
      const res = await renameSpace(space.id, { name: trimmed });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Space renamed.");
      onOpenChange(false);
      router.refresh();
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) setName(space.name);
        onOpenChange(o);
      }}
    >
      <DialogContent className="sm:max-w-sm">
        <form onSubmit={handleSubmit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Rename space</DialogTitle>
            <DialogDescription>
              Choose a new name for this space.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="space-rename">Name</Label>
            <Input
              id="space-rename"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
              disabled={isPending}
              maxLength={120}
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => onOpenChange(false)}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={isPending}>
              {isPending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Delete space dialog ───────────────────────────────────────────────────

function DeleteSpaceDialog({
  open,
  onOpenChange,
  space,
  projectCount,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  space: ProjectSpace;
  projectCount: number;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function handleDelete() {
    startTransition(async () => {
      const res = await deleteSpace(space.id, { cascadeChildren: true });
      if (!res.ok) {
        toast.error(`Could not delete space: ${res.error}`);
        return;
      }
      toast.success(
        projectCount > 0
          ? `Deleted "${space.name}". ${projectCount} project${
              projectCount !== 1 ? "s" : ""
            } moved to trash.`
          : `Deleted "${space.name}".`,
      );
      onOpenChange(false);
      router.refresh();
    });
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            Delete space &ldquo;{space.name}&rdquo;?
          </AlertDialogTitle>
          <AlertDialogDescription>
            {projectCount > 0
              ? `This space contains ${projectCount} project${
                  projectCount !== 1 ? "s" : ""
                }. They will be moved to the Trash. You can restore them from there.`
              : "The space will be removed. No projects are inside, so nothing else is affected."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isPending}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={isPending}
            onClick={(e) => {
              e.preventDefault();
              handleDelete();
            }}
            className="bg-rose-500 text-white hover:bg-rose-600"
          >
            Delete space
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
