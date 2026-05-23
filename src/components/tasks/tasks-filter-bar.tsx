'use client'

import type { ReactNode } from 'react'
import {
  ArrowUpDown,
  Calendar,
  CalendarCheck,
  CalendarClock,
  CalendarDays,
  CheckCircle2,
  Filter,
  Plus,
  Save,
  Search,
  UserRound,
  X,
} from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'
import type { TaskPriority, TaskStatus } from '@/types/database'

const STATUS_LABELS: Record<TaskStatus, string> = {
  todo: 'To Do', in_progress: 'In Progress', done: 'Done', cancelled: 'Cancelled',
}

const PRIORITY_LABELS: Record<TaskPriority, string> = {
  low: 'Low', medium: 'Medium', high: 'High', urgent: 'Urgent',
}

export interface TaskQuickFilters {
  completion: 'all' | 'incomplete' | 'completed'
  due: 'all' | 'this_week' | 'next_week'
  priority: 'all' | TaskPriority
}

export const EMPTY_TASK_QUICK_FILTERS: TaskQuickFilters = {
  completion: 'all',
  due: 'all',
  priority: 'all',
}

export type TaskSortKey = 'due_date' | 'assignee' | 'created_at' | 'updated_at' | 'completed_on'

const SORT_OPTIONS: Array<{
  value: TaskSortKey
  label: string
  icon: ReactNode
}> = [
  { value: 'due_date', label: 'Due Date', icon: <Calendar className="h-4 w-4" /> },
  { value: 'assignee', label: 'Assignee', icon: <UserRound className="h-4 w-4" /> },
  { value: 'created_at', label: 'Created On', icon: <CalendarClock className="h-4 w-4" /> },
  { value: 'updated_at', label: 'Last Modified On', icon: <CalendarDays className="h-4 w-4" /> },
  { value: 'completed_on', label: 'Completed On', icon: <CheckCircle2 className="h-4 w-4" /> },
]

interface TasksFilterBarProps {
  statusFilter: string
  onStatusChange: (v: string) => void
  quickFilters: TaskQuickFilters
  onQuickFiltersChange: (v: TaskQuickFilters) => void
  sortBy: TaskSortKey
  onSortChange: (v: TaskSortKey) => void
  onSaveView: () => void
  search: string
  onSearchChange: (v: string) => void
  calendarOpen: boolean
  onCalendarToggle: () => void
  onAddTask: () => void
}

export function TasksFilterBar({
  statusFilter, onStatusChange,
  quickFilters, onQuickFiltersChange,
  sortBy, onSortChange,
  onSaveView,
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
        <TaskSortPopover value={sortBy} onChange={onSortChange} />
        <TaskFilterPopover value={quickFilters} onChange={onQuickFiltersChange} />
        <Button
          variant="secondary"
          size="sm"
          onClick={onSaveView}
          className="h-8 gap-1.5 px-2.5 text-xs border-white/10 bg-white/4 hover:bg-white/8"
        >
          <Save className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Save view</span>
        </Button>

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

function TaskSortPopover({
  value,
  onChange,
}: {
  value: TaskSortKey
  onChange: (v: TaskSortKey) => void
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="secondary"
          size="sm"
          className={cn(
            'h-8 gap-1.5 px-2.5 text-xs border-white/10 bg-white/4 hover:bg-white/8',
            value !== 'due_date' && 'border-indigo-400/40 bg-indigo-500/10 text-indigo-200',
          )}
        >
          <ArrowUpDown className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Sort</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-56 border-white/10 bg-[#1c1d1f] p-1.5">
        {SORT_OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            className={cn(
              'flex h-9 w-full items-center gap-2.5 rounded-md px-2.5 text-left text-sm transition-colors',
              value === option.value
                ? 'bg-white/12 text-foreground ring-1 ring-white/70'
                : 'text-foreground hover:bg-white/8',
            )}
          >
            <span className="text-muted-foreground">{option.icon}</span>
            <span>{option.label}</span>
            {value === option.value && (
              <CalendarCheck className="ml-auto h-3.5 w-3.5 text-indigo-300" />
            )}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  )
}

function countActiveQuickFilters(value: TaskQuickFilters) {
  return (
    (value.completion !== 'all' ? 1 : 0) +
    (value.due !== 'all' ? 1 : 0) +
    (value.priority !== 'all' ? 1 : 0)
  )
}

function TaskFilterPopover({
  value,
  onChange,
}: {
  value: TaskQuickFilters
  onChange: (v: TaskQuickFilters) => void
}) {
  const activeCount = countActiveQuickFilters(value)
  const setFilter = <K extends keyof TaskQuickFilters>(key: K, next: TaskQuickFilters[K]) => {
    onChange({ ...value, [key]: value[key] === next ? 'all' : next })
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="secondary"
          size="sm"
          className={cn(
            'h-8 gap-1.5 px-2.5 text-xs border-white/10 bg-white/4 hover:bg-white/8',
            activeCount > 0 && 'border-indigo-400/40 bg-indigo-500/10 text-indigo-200',
          )}
        >
          <Filter className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Filter</span>
          {activeCount > 0 && (
            <span className="ml-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-indigo-500 px-1 text-[10px] font-semibold text-white">
              {activeCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[360px] border-white/10 bg-[#1c1d1f] p-0">
        <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
          <h2 className="text-sm font-semibold text-foreground">Filters</h2>
          {activeCount > 0 && (
            <button
              type="button"
              onClick={() => onChange(EMPTY_TASK_QUICK_FILTERS)}
              className="inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              <X className="h-3 w-3" />
              Clear
            </button>
          )}
        </div>

        <div className="space-y-5 p-4">
          <FilterSection title="Quick filters">
            <FilterPill
              active={value.completion === 'incomplete'}
              onClick={() => setFilter('completion', 'incomplete')}
            >
              Incomplete tasks
            </FilterPill>
            <FilterPill
              active={value.completion === 'completed'}
              onClick={() => setFilter('completion', 'completed')}
            >
              Completed tasks
            </FilterPill>
            <FilterPill
              active={value.due === 'this_week'}
              onClick={() => setFilter('due', 'this_week')}
            >
              Due this week
            </FilterPill>
            <FilterPill
              active={value.due === 'next_week'}
              onClick={() => setFilter('due', 'next_week')}
            >
              Due next week
            </FilterPill>
          </FilterSection>

          <FilterSection title="Priority">
            {(Object.keys(PRIORITY_LABELS) as TaskPriority[]).map((priority) => (
              <FilterPill
                key={priority}
                active={value.priority === priority}
                onClick={() => setFilter('priority', priority)}
              >
                {PRIORITY_LABELS[priority]}
              </FilterPill>
            ))}
          </FilterSection>
        </div>
      </PopoverContent>
    </Popover>
  )
}

function FilterSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="mb-2.5 text-xs font-semibold text-muted-foreground">{title}</h3>
      <div className="flex flex-wrap gap-2">{children}</div>
    </section>
  )
}

function FilterPill({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex h-7 items-center rounded-full border px-2.5 text-xs font-medium transition-colors',
        active
          ? 'border-indigo-400/50 bg-indigo-500/15 text-indigo-200'
          : 'border-white/15 bg-white/4 text-foreground hover:border-white/25 hover:bg-white/8',
      )}
    >
      {children}
    </button>
  )
}
