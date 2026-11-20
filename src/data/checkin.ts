import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  CHECKIN_PHOTO_QUALITY,
  normalizeCaption,
  type CheckinPhotoSize,
  type CheckinTarget,
  type PostCheckinInput,
  type PostCheckinResult,
} from '@/domain/checkin'
import { backendErrorCode, type BackendErrorCode } from '@/domain/error-codes'
import type { BackendPort } from '@/ports/backend-port'
import type { ImageEncodePort } from '@/ports/image-encode-port'
import { useBackendContext } from '@/data/backend-context-value'
import { isOffline } from '@/data/connectivity'
import { useImageEncoder } from '@/data/image-encoder-context'
import { todayKey } from '@/data/plan'

/** `['checkinTargets', groupId]`: the camera picker's rows for a group (a post refetches them). */
export function checkinTargetsKey(groupId: string) {
  return ['checkinTargets', groupId] as const
}

export interface CheckinRepository {
  targets(groupId: string): Promise<CheckinTarget[]>
  upload(groupId: string, checkinId: string, size: CheckinPhotoSize, photo: Blob): Promise<void>
  post(input: PostCheckinInput): Promise<PostCheckinResult>
}

/** Check-in reads and writes over `BackendPort` (AD-2: feature hook → repository → adapter). */
export function createCheckinRepository(backend: BackendPort): CheckinRepository {
  return {
    targets: (groupId) => backend.getCheckinTargets(groupId),
    upload: (groupId, checkinId, size, photo) =>
      backend.uploadCheckinPhoto(groupId, checkinId, size, photo),
    post: (input) => backend.postCheckin(input),
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
    retry: 1,
    retryDelay: 500,
  })
}

/** The captured frame to post: the 4:3 canvas and the device clock at the shutter. */
export interface CheckinPhoto {
  canvas: HTMLCanvasElement
  capturedAt: Date
}

/** A post the server accepted, with the 1080 rendition for the post moment's polaroid. */
export interface PostedCheckin {
  input: PostCheckinInput
  result: PostCheckinResult
  fullPhoto: Blob
}

interface Renditions {
  1080: Blob
  360: Blob
}

/** Encodes both renditions once per photo (1080 then 360, long edge, about 0.8 quality). */
async function encodeRenditions(encoder: ImageEncodePort, canvas: HTMLCanvasElement) {
  const full = await encoder.encodeWebp(canvas, 1080, CHECKIN_PHOTO_QUALITY)
  const small = await encoder.encodeWebp(canvas, 360, CHECKIN_PHOTO_QUALITY)
  const renditions: Renditions = { 1080: full, 360: small }
  return renditions
}

export interface PostCheckinFlow {
  /** "Posting…": taps are ignored. Stays true after a successful post (the camera is closing). */
  busy: boolean
  /** Why the last attempt failed (`network` also when offline); null while none has. */
  failure: BackendErrorCode | null
  /** Post was tapped: the id and caption are fixed from now on (Retry resends them). */
  frozen: boolean
  /** Posts with `caption`, or, once frozen, resends the frozen payload. */
  post: (caption: string) => void
  /** Resends the frozen payload (re-uploading what did not land). No-op before the first Post. */
  retry: () => void
}

export interface PostCheckinOptions {
  groupId: string
  commitmentId: string
  photo: CheckinPhoto
  /** Called once the server accepted the post, even if the caller unmounted meanwhile. */
  onPosted: (posted: PostedCheckin) => void
}

/**
 * The direct check-in post (Story 3.2; Story 3.3 replaces it with the outbox). The first Post fixes
 * the payload: a client UUID, the capture time and the trimmed caption. Each attempt then encodes
 * the two WebP renditions (once per photo, kept for Retry), uploads the ones not yet uploaded, and
 * calls `post_checkin`. A lost response is safe: Retry sends the same id and payload, which the
 * server answers with the stored result. `photo_missing` re-uploads both renditions on Retry.
 * On success Today and the picker refetch.
 */
export function usePostCheckin({
  groupId,
  commitmentId,
  photo,
  onPosted,
}: PostCheckinOptions): PostCheckinFlow {
  const repository = useCheckinRepository('usePostCheckin')
  const encoder = useImageEncoder('usePostCheckin')
  const queryClient = useQueryClient()
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<BackendErrorCode | null>(null)
  const [frozen, setFrozen] = useState(false)
  const busyRef = useRef(false)
  const payload = useRef<PostCheckinInput | null>(null)
  const renditions = useRef<Renditions | null>(null)
  const uploaded = useRef(new Set<CheckinPhotoSize>())
  const mounted = useRef(true)
  const onPostedRef = useRef(onPosted)

  useEffect(() => {
    onPostedRef.current = onPosted
  })

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const send = useCallback(async () => {
    const input = payload.current
    if (!input || busyRef.current) return
    busyRef.current = true
    setBusy(true)
    setFailure(null)
    let posted = false
    try {
      if (isOffline()) {
        setFailure('network')
        return
      }
      renditions.current ??= await encodeRenditions(encoder, photo.canvas)
      const blobs = renditions.current
      for (const size of [1080, 360] as const) {
        if (uploaded.current.has(size)) continue
        await repository.upload(input.groupId, input.id, size, blobs[size])
        uploaded.current.add(size)
      }
      const result = await repository.post(input)
      posted = true
      void queryClient.invalidateQueries({ queryKey: todayKey(input.groupId) })
      void queryClient.invalidateQueries({ queryKey: checkinTargetsKey(input.groupId) })
      onPostedRef.current({ input, result, fullPhoto: blobs[1080] })
    } catch (error) {
      const code = backendErrorCode(error)
      // The server found no photo: upload both again on Retry.
      if (code === 'photo_missing') uploaded.current.clear()
      if (mounted.current) setFailure(code)
    } finally {
      if (!posted) {
        busyRef.current = false
        if (mounted.current) setBusy(false)
      }
    }
  }, [encoder, photo.canvas, queryClient, repository])

  const post = useCallback(
    (caption: string) => {
      if (busyRef.current) return
      if (!payload.current) {
        payload.current = {
          id: crypto.randomUUID(),
          groupId,
          commitmentId,
          capturedAt: photo.capturedAt.toISOString(),
          caption: normalizeCaption(caption),
        }
        setFrozen(true)
      }
      void send()
    },
    [commitmentId, groupId, photo.capturedAt, send],
  )

  const retry = useCallback(() => {
    void send()
  }, [send])

  return { busy, failure, frozen, post, retry }
}
