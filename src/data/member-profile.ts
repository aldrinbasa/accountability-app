import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { MemberProfile, Title } from '@/domain/badges'
import type { FeedCheckin } from '@/domain/feed'
import type { BackendPort } from '@/ports/backend-port'
import { useBackendContext } from '@/data/backend-context-value'
import { retryOnline } from '@/data/query-client'

/** `['memberProfile', groupId]`: every profile of a group (invalidated after each confirmed post). */
export function memberProfileGroupKey(groupId: string) {
  return ['memberProfile', groupId] as const
}

/** `['memberProfile', groupId, userId]`: `get_member_profile` (AD-12). */
export function memberProfileKey(groupId: string, userId: string) {
  return [...memberProfileGroupKey(groupId), userId] as const
}

export const TITLES_KEY = ['titles'] as const

/** `['memberCheckins', groupId, userId]`: a member's latest check-ins in the group. */
export function memberCheckinsKey(groupId: string, userId: string) {
  return ['memberCheckins', groupId, userId] as const
}

/** How many recent check-ins a member profile shows. */
export const MEMBER_CHECKINS_LIMIT = 12

export interface MemberProfileRepository {
  profile(groupId: string, userId: string): Promise<MemberProfile | null>
  titles(): Promise<Title[]>
  checkins(groupId: string, userId: string): Promise<FeedCheckin[]>
}

/** Profile reads over `BackendPort` (AD-2: feature hook → repository → adapter). */
export function createMemberProfileRepository(backend: BackendPort): MemberProfileRepository {
  return {
    profile: (groupId, userId) => backend.getMemberProfile(groupId, userId),
    titles: () => backend.listTitles(),
    checkins: (groupId, userId) =>
      backend.listMemberCheckins(groupId, userId, MEMBER_CHECKINS_LIMIT),
  }
}

function useRepository(hook: string) {
  const { backend } = useBackendContext(hook)
  return useMemo(() => createMemberProfileRepository(backend), [backend])
}

/**
 * A member's profile in a group (Story 4.6), for Me and the member profile; idle while either id
 * is null. Cached data shows at once; refetches when a screen using it opens and on app focus, and
 * the outbox invalidates the group's profiles after every confirmed post (pending seals). Retries
 * once.
 */
export function useMemberProfile(groupId: string | null, userId: string | null) {
  const repository = useRepository('useMemberProfile')
  return useQuery({
    queryKey: memberProfileKey(groupId ?? '', userId ?? ''),
    queryFn: () => repository.profile(groupId as string, userId as string),
    enabled: groupId !== null && userId !== null,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
    retry: retryOnline(1),
    retryDelay: 500,
  })
}

/** The title ladder: a fixed catalog, read once per session (and kept in the saved cache). */
export function useTitles() {
  const repository = useRepository('useTitles')
  return useQuery({
    queryKey: TITLES_KEY,
    queryFn: () => repository.titles(),
    staleTime: Infinity,
    retry: retryOnline(1),
    retryDelay: 500,
  })
}

/** A member's latest check-ins in the group, newest first (the member profile's thumbnails). */
export function useMemberCheckins(groupId: string, userId: string, enabled: boolean) {
  const repository = useRepository('useMemberCheckins')
  return useQuery({
    queryKey: memberCheckinsKey(groupId, userId),
    queryFn: () => repository.checkins(groupId, userId),
    enabled,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
    retry: retryOnline(1),
    retryDelay: 500,
  })
}
