import { Images, Ranking, Sun, UserCircle } from '@phosphor-icons/react'
import type { Icon as PhosphorIcon } from '@phosphor-icons/react'

export const TODAY_PATH = '/today'

export type TabPath = '/today' | '/feed' | '/board' | '/me'

export interface Tab {
  path: TabPath
  label: string
  icon: PhosphorIcon
}

/** Nav order: Today, Feed, (Camera button), Board, Me. */
export const LEADING_TABS: readonly Tab[] = [
  { path: '/today', label: 'Today', icon: Sun },
  { path: '/feed', label: 'Feed', icon: Images },
]
export const TRAILING_TABS: readonly Tab[] = [
  { path: '/board', label: 'Board', icon: Ranking },
  { path: '/me', label: 'Me', icon: UserCircle },
]

const TAB_PATHS = new Set<string>([...LEADING_TABS, ...TRAILING_TABS].map((tab) => tab.path))

export function isTabPath(pathname: string): pathname is TabPath {
  return TAB_PATHS.has(pathname)
}

/** Router location state carried by tab entries that sit on top of a /today entry. */
export interface TabLocationState {
  fromToday?: boolean
  /** The `?g=` search of the /today entry behind this one. */
  todaySearch?: string
}

/** Search of the /today entry behind a tab entry, or null when no Today entry sits behind it. */
export function todaySearchBehind(state: unknown): string | null {
  if (!cameFromToday(state)) return null
  const search = (state as TabLocationState).todaySearch
  return typeof search === 'string' ? search : null
}

export function cameFromToday(state: unknown): boolean {
  return !!state && typeof state === 'object' && (state as TabLocationState).fromToday === true
}
