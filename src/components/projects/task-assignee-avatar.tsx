import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { cn } from '@/lib/utils'

function initials(name: string | null | undefined, email: string | null | undefined) {
  const src = (name ?? email ?? '?').trim()
  const parts = src.split(/\s+/).filter(Boolean)
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
  return (src[0] ?? '?').toUpperCase()
}

interface Props {
  name?: string | null
  email?: string | null
  photoUrl?: string | null
  size?: 'xs' | 'sm' | 'md'
  className?: string
}

export function TaskAssigneeAvatar({ name, email, photoUrl, size = 'sm', className }: Props) {
  const sizeCls =
    size === 'xs' ? 'h-5 w-5 text-[9px]' :
    size === 'md' ? 'h-8 w-8 text-xs' :
    'h-6 w-6 text-[10px]'
  return (
    <Avatar className={cn(sizeCls, className)} title={name ?? email ?? undefined}>
      {photoUrl && <AvatarImage src={photoUrl} alt={name ?? email ?? ''} />}
      <AvatarFallback className="font-medium">{initials(name, email)}</AvatarFallback>
    </Avatar>
  )
}
