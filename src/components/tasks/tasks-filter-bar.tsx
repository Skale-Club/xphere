'use client'

import { Search, CalendarDays, Plus } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'
import type { TaskStatus } from '@/types/database'

const STATUS_LABELS: Record<TaskStatus, string> = {
  todo: 'To Do', in_progress: 'In Progress', done: 'Done', cancelled: 'Cancelled',
}

interface TasksFilterBarProps {
  statusFilter: string
  onStatusChange: (v: string) => void
  search: string
  onSearchChange: (v: string) => void
  calendarOpen: boolean
  onCalendarToggle: () => void
  onAddTask: () => void
}

export function TasksFilterBar({
  statusFilter, onStatusChange,
  search, onSearchChange,
  calendarOpen, onCalendarToggle,
  onAddTask,
}: TasksFilterBarProps) {
  return (
    <div className="flex items-center gap-2 px-4 sm:px-6 py-2.5 border-b border-border shrink-0">
      {/* Left: Add Task */}
      <Button
        size="sm"
        onClick={onAddTask}
        className="gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white h-8 shrink-0"
      >
        <Plus className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">Add Task</span>
        <span className="sm:hidden">Add</span>
      </Button>

      {/* Right: filters */}
      <div className="ml-auto flex items-center gap-2">
        <Select value={statusFilter} onValueChange={onStatusChange}>
          <SelectTrigger className="h-8 w-auto min-w-[110px] text-xs border-white/10 bg-white/4">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Status: All</SelectItem>
            {(Object.keys(STATUS_LABELS) as TaskStatus[]).map((s) => (
              <SelectItem key={s} value={s}>{STATUS_LABELS[s]}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
          <Input
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search Tasks..."
            className="h-8 pl-8 text-xs w-36 sm:w-48 border-white/10 bg-white/4"
          />
        </div>

        {/* Calendar toggle — mobile only */}
        <Button
          variant="ghost"
          size="icon"
          onClick={onCalendarToggle}
          className={cn(
            'lg:hidden h-8 w-8 shrink-0',
            calendarOpen ? 'text-indigo-400 bg-indigo-500/10' : 'text-muted-foreground',
          )}
          aria-label="Toggle calendar"
        >
          <CalendarDays className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}
