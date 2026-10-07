import {
  BarChart3,
  FileSearch,
  Grid3x3,
  Megaphone,
  MessageSquareQuote,
  Settings2,
  Sparkles,
  Store,
  Swords,
  type LucideIcon,
} from 'lucide-react'

/** The pages of a Local SEO location, listed under it in the SEO sub-sidebar. */
export const LOCATION_PAGES: { label: string; segment: string; icon: LucideIcon }[] = [
  { label: 'Rankings', segment: '', icon: Grid3x3 },
  { label: 'Trends', segment: 'trends', icon: BarChart3 },
  { label: 'Competitors', segment: 'competitors', icon: Swords },
  { label: 'Reviews', segment: 'reviews', icon: MessageSquareQuote },
  { label: 'Posts', segment: 'posts', icon: Megaphone },
  { label: 'Profile', segment: 'profile', icon: Store },
  { label: 'Audit', segment: 'audit', icon: FileSearch },
  { label: 'Citations & AI', segment: 'visibility', icon: Sparkles },
  { label: 'Settings', segment: 'settings', icon: Settings2 },
]
