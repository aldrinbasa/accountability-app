import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { Board, GroupWeek } from '@/domain/board'
import type { BackendPort } from '@/ports/backend-port'
import { useBackendContext } from '@/data/backend-context-value'
import {
  readDevice,
  removeDeviceKeysWithPrefix,
  resetDeviceMemory,
  writeDevice,
} from '@/data/device-storage'
import { retryOnline } from '@/data/query-client'

/** `['groupWeek', groupId]`: the group's current week (`get_group_week`). */
export function groupWeekKey(groupId: string) {
  return ['groupWeek', groupId] as const
}

/** `['board', groupId]`: every week's board of a group (invalidated after each confirmed post). */
export function boardGroupKey(groupId: string) {
  return ['board', groupId] as const
}

/** `['board', groupId, weekStart]`: `get_board` for one week (AD-12). */
export function boardKey(groupId: string, weekStart: string) {
  return [...boardGroupKey(groupId), weekStart] as const
}

export interface BoardRepository {
  groupWeek(groupId: string): Promise<GroupWeek>
  board(groupId: string, weekStart: string): Promise<Board>
}

/** Board reads over `BackendPort` (AD-2: feature hook → repository → adapter). */
export function createBoardRepository(backend: BackendPort): BoardRepository {
  return {
    groupWeek: (groupId) => backend.getGroupWeek(groupId),
    board: (groupId, weekStart) => backend.getBoard(groupId, weekStart),
  }
}

function useBoardRepository(hook: string): BoardRepository {
  const { backend } = useBackendContext(hook)
  return useMemo(() => createBoardRepository(backend), [backend])
}

/**
 * The group's current week from the server (AD-11: never device date math). Refetches when a
 * screen using it opens and on app focus, so a new week shows up. Retries once.
 */
export function useGroupWeek(groupId: string) {
  const repository = useBoardRepository('useGroupWeek')
  return useQuery({
    queryKey: groupWeekKey(groupId),
    queryFn: () => repository.groupWeek(groupId),
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
    retry: retryOnline(1),
    retryDelay: 500,
  })
}

/**
 * `get_board` for a group and week under `['board', groupId, weekStart]`, idle until the week is
 * known. Cached data shows at once; refetches when a screen using it opens (`'always'`) and on app
 * focus, and the outbox invalidates `['board', groupId]` after every confirmed post (push messages
 * join in Epic 6). Retries once.
 */
export function useBoard(groupId: string, weekStart: string | undefined) {
  const repository = useBoardRepository('useBoard')
  return useQuery({
    queryKey: boardKey(groupId, weekStart ?? ''),
    queryFn: () => repository.board(groupId, weekStart as string),
    enabled: weekStart !== undefined,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
    retry: retryOnline(1),
    retryDelay: 500,
  })
}

/**
 * Device-only rank memory (AD-12): the rank this device last showed per group, so a drop since the
 * last look plays the rank chip's wobble once. Belongs to the signed-in account: sign-out clears it.
 */
const LAST_SEEN_RANK_PREFIX = 'proofy.lastSeenRank.'

export function lastSeenRankKey(groupId: string): string {
  return `${LAST_SEEN_RANK_PREFIX}${groupId}`
}

/** The rank this device last showed for the group, or null when it never showed one. */
export function getLastSeenRank(groupId: string): number | null {
  const value = readDevice(lastSeenRankKey(groupId))
  if (value === null) return null
  const rank = Number.parseInt(value, 10)
  return Number.isNaN(rank) ? null : rank
}

export function setLastSeenRank(groupId: string, rank: number): void {
  writeDevice(lastSeenRankKey(groupId), String(rank))
}

/** Forget every group's last-seen rank (sign-out or another account signing in). */
export function clearLastSeenRanks(): void {
  removeDeviceKeysWithPrefix(LAST_SEEN_RANK_PREFIX)
}

/** Tests only: forget the in-memory fallback. */
export function resetLastSeenRanksMemory(): void {
  resetDeviceMemory((key) => key.startsWith(LAST_SEEN_RANK_PREFIX))
}
