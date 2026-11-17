import { useCallback, useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router'
import {
  endedMembershipFor,
  nextFocusAfterLeave,
  resolveFocusedGroup,
  type EndedMembership,
  type MyGroup,
} from '@/domain/groups'
import { getStoredFocusedGroup, setStoredFocusedGroup } from '@/data/focused-group'
import { useEndedMemberships, useMyGroups } from '@/data/groups'

/** The search string with `?g=` set to `groupId`, or removed for null. Other params are kept. */
export function searchWithGroup(search: string, groupId: string | null): string {
  const params = new URLSearchParams(search)
  if (groupId === null) params.delete('g')
  else params.set('g', groupId)
  const next = params.toString()
  return next ? `?${next}` : ''
}

export interface FocusedGroup {
  /** The focused group, or null while loading, after a failed load, or with no current groups. */
  group: MyGroup | null
  /** Current groups, or undefined until the first load succeeds. */
  groups: MyGroup[] | undefined
  /** The `['groups', 'me']` query (loading and failure states, refetch). */
  query: ReturnType<typeof useMyGroups>
  /** Focus another group: stores it and replaces `?g=` on the current screen. */
  setFocus: (groupId: string) => void
}

/**
 * The focused group for this screen (AD-12): URL `?g=` when current, else the stored one, else the
 * earliest joined. Read-only: the shell runs `useSyncFocusedGroup` once to write the choice back to
 * the URL and the device store.
 */
export function useFocusedGroup(): FocusedGroup {
  const query = useMyGroups()
  const location = useLocation()
  const navigate = useNavigate()
  const groups = query.data
  const urlId = new URLSearchParams(location.search).get('g')
  const group = groups ? resolveFocusedGroup(urlId, getStoredFocusedGroup(), groups) : null

  const setFocus = useCallback(
    (groupId: string) => {
      setStoredFocusedGroup(groupId)
      void navigate(
        {
          pathname: location.pathname,
          search: searchWithGroup(location.search, groupId),
          hash: location.hash,
        },
        { replace: true, state: location.state },
      )
    },
    [navigate, location.pathname, location.search, location.hash, location.state],
  )

  return { group, groups, query, setFocus }
}

/**
 * The group `?g=` points at when the member is no longer in it (left, removed), so the shell shows
 * "You're not in {Group} anymore." instead of a tab. Null otherwise, while loading, and when not
 * `active` (the shell passes true on Today, Feed and Board only; group settings has its own).
 * Also null when that group is the stored focused group: the URL is then the app's own synced
 * `?g=` (or the PWA reopening on it), so focus moves on as usual and Today tells a removal by toast.
 */
export function useStaleGroupLink(active: boolean): EndedMembership | null {
  const { data: groups } = useMyGroups()
  const { data: ended } = useEndedMemberships()
  const { search } = useLocation()
  if (!active || !groups || !ended) return null
  const stale = endedMembershipFor({ groups, ended }, new URLSearchParams(search).get('g'))
  if (!stale || stale.groupId === getStoredFocusedGroup()) return null
  return stale
}

/**
 * Keeps the URL and the device store on the resolved focus. Once the groups load and the resolved
 * id differs from `?g=`, the URL is replaced (never pushed, and the location state is kept, so tab
 * history is not disturbed); with no groups `?g=` is dropped. `paused` while the shell shows the
 * "not in {Group} anymore" state for an ended group's `?g=`, which must stay in the URL until "Go to
 * Today". Mounted once, in the app shell.
 */
export function useSyncFocusedGroup(paused = false): void {
  const { group, groups } = useFocusedGroup()
  const location = useLocation()
  const navigate = useNavigate()
  const urlId = new URLSearchParams(location.search).get('g')
  // undefined: groups not loaded yet (or a stale link shows), so nothing to sync.
  const resolvedId = groups === undefined || paused ? undefined : (group?.id ?? null)

  useEffect(() => {
    if (resolvedId === undefined) return
    if (resolvedId !== null) setStoredFocusedGroup(resolvedId)
    if (resolvedId === urlId) return
    void navigate(
      {
        pathname: location.pathname,
        search: searchWithGroup(location.search, resolvedId),
        hash: location.hash,
      },
      { replace: true, state: location.state },
    )
    // Reacts to the resolved focus and the URL's group; the rest of the location is read then.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolvedId, urlId])
}

/** After creating or joining a group: focus it and open Today on it. */
export function useOpenGroupOnToday(): (groupId: string) => void {
  const navigate = useNavigate()
  return useCallback(
    (groupId: string) => {
      setStoredFocusedGroup(groupId)
      void navigate({ pathname: '/today', search: searchWithGroup('', groupId) }, { replace: true })
    },
    [navigate],
  )
}

/** "Go to Today" from a stale link: `/today` with `?g=` dropped, so focus resolves afresh. */
export function useGoToTodayWithoutGroup(): () => void {
  const navigate = useNavigate()
  const { search } = useLocation()
  return useCallback(() => {
    void navigate({ pathname: '/today', search: searchWithGroup(search, null) }, { replace: true })
  }, [navigate, search])
}

/**
 * After leaving a group: focus the next current group (earliest joined) and open Today on it, or
 * forget the focus and open Today (the Create or join a group screen) when none remain.
 */
export function useMoveFocusAfterLeave(): (remaining: readonly MyGroup[], leftId: string) => void {
  const navigate = useNavigate()
  return useCallback(
    (remaining: readonly MyGroup[], leftId: string) => {
      const next = nextFocusAfterLeave(remaining, leftId)
      setStoredFocusedGroup(next?.id ?? null)
      void navigate(
        { pathname: '/today', search: searchWithGroup('', next?.id ?? null) },
        { replace: true },
      )
    },
    [navigate],
  )
}

/** Opens `/join/{code}`, keeping the current `?g=` (pushed, so back returns here). */
export function useOpenJoinScreen(): (code: string) => void {
  const navigate = useNavigate()
  const { search } = useLocation()
  return useCallback(
    (code: string) => {
      void navigate({ pathname: `/join/${encodeURIComponent(code)}`, search })
    },
    [navigate, search],
  )
}
