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
    <div className="flex flex-row flex-nowrap items-center gap-1.5 sm:gap-2 px-4 sm:px-6 lg:px-8 pt-6 pb-6">
      {/* Left: Add Task */}
      <Button size="sm" onClick={onAddTask} className="h-8 gap-1.5 shrink-0">
        <Plus className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">Task</span>
      </Button>

      {/* Search */}
      <div className="relative flex-1 min-w-0 max-w-[200px] sm:max-w-xs">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-text-tertiary pointer-events-none" />
        <Input
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search…"
          className="h-8 pl-8 text-[12.5px]"
        />
      </div>

      <div className="hidden sm:block flex-1" />

      {/* Desktop: inline filters */}
      <div className="hidden sm:flex items-center gap-2">
        <TaskSortPopover value={sortBy} onChange={onSortChange} />
        <TaskFilterPopover value={quickFilters} onChange={onQuickFiltersChange} />
        <Button variant="secondary" size="sm" onClick={onSaveView} className="h-8 gap-1.5 text-[12.5px]">
          <Save className="h-3.5 w-3.5" />
          <span>Save view</span>
        </Button>

        <Select value={statusFilter} onValueChange={onStatusChange}>
          <SelectTrigger className="h-8 w-auto min-w-[110px] text-[12.5px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Status: All</SelectItem>
            {(Object.keys(STATUS_LABELS) as TaskStatus[]).map((s) => (
              <SelectItem key={s} value={s}>{STATUS_LABELS[s]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Mobile: compact filters + calendar */}
      <div className="sm:hidden flex items-center gap-1.5">
        <TaskSortPopover value={sortBy} onChange={onSortChange} iconOnly />
        <TaskFilterPopover value={quickFilters} onChange={onQuickFiltersChange} iconOnly />

        <Select value={statusFilter} onValueChange={onStatusChange}>
          <SelectTrigger className="h-8 w-9 px-0 justify-center text-[12.5px]">
            <Filter className="h-3.5 w-3.5 text-text-tertiary shrink-0" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            {(Object.keys(STATUS_LABELS) as TaskStatus[]).map((s) => (
              <SelectItem key={s} value={s}>{STATUS_LABELS[s]}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Button
          variant="ghost"
          size="sm"
          onClick={onCalendarToggle}
          className={cn(
            'h-8 w-8 px-0 shrink-0',
            calendarOpen ? 'text-accent bg-accent-muted/20' : 'text-text-tertiary',
          )}
          aria-label="Toggle calendar"
        >
          <CalendarDays className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  )
}

function TaskSortPopover({
  value,
  onChange,
  iconOnly,
}: {
  value: TaskSortKey
  onChange: (v: TaskSortKey) => void
  iconOnly?: boolean
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="secondary"
          size="sm"
          className={cn(
            'h-8 text-[12.5px]',
            iconOnly ? 'px-2.5' : 'gap-1.5 px-2.5',
            value !== 'due_date' && 'border-accent/40 bg-accent-muted/20 text-accent',
          )}
        >
          <ArrowUpDown className="h-3.5 w-3.5" />
          {!iconOnly && <span>Sort</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-56 p-1.5">
        {SORT_OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            className={cn(
              'flex h-9 w-full items-center gap-2.5 rounded-md px-2.5 text-left text-sm transition-colors',
              value === option.value
                ? 'bg-accent-muted text-accent-foreground ring-1 ring-accent/50'
                : 'text-text-primary hover:bg-bg-secondary',
            )}
          >
            <span className="text-muted-foreground">{option.icon}</span>
            <span>{option.label}</span>
            {value === option.value && (
              <CalendarCheck className="ml-auto h-3.5 w-3.5 text-accent" />
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
  iconOnly,
}: {
  value: TaskQuickFilters
  onChange: (v: TaskQuickFilters) => void
  iconOnly?: boolean
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
            'h-8 text-[12.5px]',
            iconOnly ? 'px-2.5' : 'gap-1.5 px-2.5',
            activeCount > 0 && 'border-accent/40 bg-accent-muted/20 text-accent',
          )}
        >
          <Filter className="h-3.5 w-3.5" />
          {!iconOnly && <span>Filter</span>}
          {activeCount > 0 && (
            <span className="ml-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-semibold text-white">
              {activeCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[360px] p-0">
        <div className="flex items-center justify-between border-b border-border-subtle px-4 py-3">
          <h2 className="text-sm font-semibold text-text-primary">Filters</h2>
          {activeCount > 0 && (
            <button
              type="button"
              onClick={() => onChange(EMPTY_TASK_QUICK_FILTERS)}
              className="inline-flex items-center gap-1 text-xs text-text-tertiary transition-colors hover:text-text-primary"
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
          ? 'border-accent/50 bg-accent-muted/30 text-accent'
          : 'border-border-subtle bg-bg-secondary text-text-secondary hover:border-border-strong hover:bg-bg-tertiary',
      )}
    >
      {children}
    </button>
  )
}
