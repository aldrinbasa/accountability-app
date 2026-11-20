import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  CHECKIN_PHOTO_QUALITY,
  normalizeCaption,
  type CheckinPhotoSize,
  type CheckinTarget,
} from '@/domain/checkin'
import type { MyGroupsSnapshot } from '@/domain/groups'
import type { BackendPort } from '@/ports/backend-port'
import type { ImageEncodePort } from '@/ports/image-encode-port'
import { useBackendContext } from '@/data/backend-context-value'
import { toOutboxPhoto, useCheckinOutbox, type FirstAttempt } from '@/data/checkin-outbox'
import { isOffline } from '@/data/connectivity'
import { MY_GROUPS_KEY } from '@/data/groups'
import { useImageEncoder } from '@/data/image-encoder-context'
import type { OutboxPhoto } from '@/data/outbox-db'
import { retryOnline } from '@/data/query-client'

/** `['checkinTargets', groupId]`: the camera picker's rows for a group (a post refetches them). */
export function checkinTargetsKey(groupId: string) {
  return ['checkinTargets', groupId] as const
}

export interface CheckinRepository {
  targets(groupId: string): Promise<CheckinTarget[]>
}

/**
 * Check-in reads over `BackendPort` (AD-2: feature hook → repository → adapter). Uploads and posts
 * go only through the outbox's sender (src/data/checkin-outbox.ts).
 */
export function createCheckinRepository(backend: BackendPort): CheckinRepository {
  return {
    targets: (groupId) => backend.getCheckinTargets(groupId),
  }
}

function useCheckinRepository(hook: string): CheckinRepository {
  const { backend } = useBackendContext(hook)
  return useMemo(() => createCheckinRepository(backend), [backend])
}

/**
 * The snap-first picker's rows (`get_checkin_targets`) for `groupId`; nothing is fetched without a
 * group. Always refetched when the picker opens (the day or the counts may have moved). Retries once.
 */
export function useCheckinTargets(groupId: string | null) {
  const repository = useCheckinRepository('useCheckinTargets')
  return useQuery({
    queryKey: checkinTargetsKey(groupId ?? ''),
    queryFn: () => repository.targets(groupId ?? ''),
    enabled: groupId !== null,
    staleTime: 0,
    refetchOnMount: 'always',
    retry: retryOnline(1),
    retryDelay: 500,
  })
}

/** The captured frame to post: the 4:3 canvas and the device clock at the shutter. */
export interface CheckinPhoto {
  canvas: HTMLCanvasElement
  capturedAt: Date
}

/** What a check-in is for: the group, the commitment or task, and its title. */
export interface PostTarget {
  groupId: string
  commitmentId: string
  title: string
}

/** "Posting…" waits at most this long for the first send before the camera closes. */
export const POSTING_LIMIT_MS = 15_000

/** Encodes both renditions once per photo (1080 then 360, long edge, about 0.8 quality). */
async function encodeRenditions(
  encoder: ImageEncodePort,
  canvas: HTMLCanvasElement,
): Promise<Record<CheckinPhotoSize, OutboxPhoto>> {
  const full = await encoder.encodeWebp(canvas, 1080, CHECKIN_PHOTO_QUALITY)
  const small = await encoder.encodeWebp(canvas, 360, CHECKIN_PHOTO_QUALITY)
  return { 1080: await toOutboxPhoto(full), 360: await toOutboxPhoto(small) }
}

export interface PostCheckinFlow {
  /** "Posting…": taps are ignored. Stays true once the post is handed to the outbox. */
  busy: boolean
  /** Encoding or writing the entry failed: nothing was queued, so only Retry here can send it. */
  failed: boolean
  /** Post was tapped: the id and caption are fixed from now on (Retry resends them). */
  frozen: boolean
  /** Posts with `caption`, or, once frozen, retries the frozen payload. */
  post: (caption: string) => void
  /** Retries the frozen payload. No-op before the first Post. */
  retry: () => void
}

export interface PostCheckinOptions {
  target: PostTarget
  photo: CheckinPhoto
  /**
   * The post is in the outbox and the camera can close: offline at once (`waiting`), online once the
   * sender's first attempt settles (`sent`, `waiting` while it keeps retrying, or `rejected`). Called
   * even if the caller unmounted meanwhile.
   */
  onDone: (outcome: FirstAttempt) => void
}

/**
 * Post through the outbox (Story 3.3, replacing Story 3.2's direct send). The first Post fixes the
 * payload: a client UUID, the capture time and the trimmed caption. Post then encodes both WebP
 * renditions (once per photo) and writes the outbox entry; from there the sender uploads and calls
 * `post_checkin`, and retries on its own. Only an encode or device-store failure keeps the preview
 * (`failed`), since nothing was queued.
 */
export function usePostCheckin({ target, photo, onDone }: PostCheckinOptions): PostCheckinFlow {
  const outbox = useCheckinOutbox('usePostCheckin')
  const encoder = useImageEncoder('usePostCheckin')
  const queryClient = useQueryClient()
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const [frozen, setFrozen] = useState(false)
  const busyRef = useRef(false)
  const payload = useRef<{ id: string; capturedAt: string; caption: string | null } | null>(null)
  const photos = useRef<Record<CheckinPhotoSize, OutboxPhoto> | null>(null)
  const queued = useRef(false)
  const mounted = useRef(true)
  const onDoneRef = useRef(onDone)

  useEffect(() => {
    onDoneRef.current = onDone
  })

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const { groupId, commitmentId, title } = target

  const send = useCallback(async () => {
    const input = payload.current
    if (!input || busyRef.current) return
    busyRef.current = true
    setBusy(true)
    setFailed(false)
    let handedOff = false
    try {
      if (!queued.current) {
        photos.current ??= await encodeRenditions(encoder, photo.canvas)
        const groupName =
          queryClient
            .getQueryData<MyGroupsSnapshot>(MY_GROUPS_KEY)
            ?.groups.find((group) => group.id === groupId)?.name ?? ''
        await outbox.enqueue({
          id: input.id,
          groupId,
          groupName,
          commitmentId,
          title,
          capturedAt: input.capturedAt,
          caption: input.caption,
          photos: photos.current,
        })
        queued.current = true
      }
      handedOff = true
      // A slow connection never holds the camera: after 15 s it closes to the waiting Banner
      // while the send carries on in the background.
      let limit: ReturnType<typeof setTimeout> | undefined
      const outcome = isOffline()
        ? 'waiting'
        : await Promise.race([
            outbox.firstAttempt(input.id),
            new Promise<FirstAttempt>((resolve) => {
              limit = setTimeout(() => resolve('waiting'), POSTING_LIMIT_MS)
            }),
          ])
      clearTimeout(limit)
      onDoneRef.current(outcome)
    } catch {
      handedOff = false
      if (mounted.current) setFailed(true)
    } finally {
      if (!handedOff) {
        busyRef.current = false
        if (mounted.current) setBusy(false)
      }
    }
  }, [commitmentId, encoder, groupId, outbox, photo.canvas, queryClient, title])

  const post = useCallback(
    (caption: string) => {
      if (busyRef.current) return
      if (!payload.current) {
        payload.current = {
          id: crypto.randomUUID(),
          capturedAt: photo.capturedAt.toISOString(),
          caption: normalizeCaption(caption),
        }
        setFrozen(true)
      }
      void send()
    },
    [photo.capturedAt, send],
  )

  const retry = useCallback(() => {
    void send()
  }, [send])

  return { busy, failed, frozen, post, retry }
}
