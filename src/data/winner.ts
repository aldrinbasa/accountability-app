import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { WinnerWeek } from '@/domain/winner'
import type { BackendPort } from '@/ports/backend-port'
import { useBackendContext } from '@/data/backend-context-value'
import { readDevice, removeDeviceKeysWithPrefix, writeDevice } from '@/data/device-storage'
import { retryOnline } from '@/data/query-client'

/** The key's week for the group's most recent locked week (no week asked). */
export const LATEST_WINNER_WEEK = 'latest'

/** `['winner', groupId, weekStart]`: `get_winner_week` for one week, or `'latest'` (AD-12). */
export function winnerKey(groupId: string, weekStart: string | null) {
  return ['winner', groupId, weekStart ?? LATEST_WINNER_WEEK] as const
}

export interface WinnerRepository {
  winnerWeek(groupId: string, weekStart: string | null): Promise<WinnerWeek | null>
}

/** Winner reads over `BackendPort` (AD-2: feature hook → repository → adapter). */
export function createWinnerRepository(backend: BackendPort): WinnerRepository {
  return {
    winnerWeek: (groupId, weekStart) => backend.getWinnerWeek(groupId, weekStart),
  }
}

/**
 * `get_winner_week` for a group and week (null: the group's most recent locked week), idle while
 * `groupId` is null. Refetches when a screen using it opens and on app focus, so a week that locked
 * while the app was away shows up. Retries once.
 */
export function useWinnerWeek(groupId: string | null, weekStart: string | null) {
  const { backend } = useBackendContext('useWinnerWeek')
  const repository = useMemo(() => createWinnerRepository(backend), [backend])
  return useQuery({
    queryKey: winnerKey(groupId ?? '', weekStart),
    queryFn: () => repository.winnerWeek(groupId as string, weekStart),
    enabled: groupId !== null,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
    retry: retryOnline(1),
    retryDelay: 500,
  })
}

/**
 * Device-only "winner card seen" memory (AD-12), per group and week. Belongs to the signed-in
 * account: sign-out clears it.
 */
const WINNER_SEEN_PREFIX = 'proofy.winnerSeen.'

export function winnerSeenKey(groupId: string, weekStart: string): string {
  return `${WINNER_SEEN_PREFIX}${groupId}.${weekStart}`
}

export function isWinnerSeen(groupId: string, weekStart: string): boolean {
  return readDevice(winnerSeenKey(groupId, weekStart)) !== null
}

export function markWinnerSeen(groupId: string, weekStart: string): void {
  writeDevice(winnerSeenKey(groupId, weekStart), '1')
}

/** Forget every seen winner card (sign-out or another account signing in). */
export function clearWinnerSeen(): void {
  removeDeviceKeysWithPrefix(WINNER_SEEN_PREFIX)
}
