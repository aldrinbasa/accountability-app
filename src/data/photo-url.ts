import { useState } from 'react'
import { useQueries, useQuery } from '@tanstack/react-query'
import { checkinPhotoPath } from '@/domain/checkin'
import { BackendError, backendErrorCode } from '@/domain/error-codes'
import { photoRenditions, type ConnectionHints } from '@/domain/feed'
import { PHOTO_CACHE_NAME } from '@/domain/photo-cache'
import type { BackendPort } from '@/ports/backend-port'
import { useBackendContext } from '@/data/backend-context-value'
import { useOnline } from '@/data/connectivity'
import { retryOnline } from '@/data/query-client'

/**
 * Check-in photo URLs (Story 3.4, AD-9). Each object path gets its own query of a 10-minute signed
 * URL, re-minted every 9 minutes while shown and never persisted (`meta.persist: false`); a failed
 * re-mint raises no "Couldn't refresh." toast (`meta.silentRefresh`). All paths asked for in the same
 * tick are signed with one request. Offline, the token-less object URL is used instead: only the
 * service worker's photo cache (keyed by path, without the token) can answer it.
 */

/**
 * Deletes the service worker's photo cache (the session ended): another account on this device must
 * never read these photos offline. Never throws.
 */
export async function clearPhotoCache(): Promise<void> {
  if (typeof caches === 'undefined') return
  try {
    await caches.delete(PHOTO_CACHE_NAME)
  } catch {
    // Storage blocked: nothing more to do.
  }
}

/** The private photo buckets: check-in photos (Story 3.4) and profile photos (Story 3.6). */
export type PhotoBucket = 'checkins' | 'avatars'

/** `['photoUrl', bucket, path]`: one signed URL per object path. */
export function photoUrlKey(path: string, bucket: PhotoBucket = 'checkins') {
  return ['photoUrl', bucket, path] as const
}

/** Re-minted this often while shown (the URL lives 10 minutes). */
export const PHOTO_URL_REFRESH_MS = 9 * 60_000
/** Dropped this long after the last photo box using it went away. */
export const PHOTO_URL_GC_MS = 10 * 60_000

export interface PhotoSigner {
  /** A signed URL for `path`; rejects when the caller may not read it or the request fails. */
  sign(path: string): Promise<string>
}

interface Waiter {
  resolve: (url: string) => void
  reject: (error: unknown) => void
}

/**
 * Collects the paths of `bucket` asked for in one tick and signs them with one `signCheckinPhotos`
 * (or `signAvatarPhotos`) call.
 */
export function createPhotoSigner(
  backend: BackendPort,
  bucket: PhotoBucket = 'checkins',
): PhotoSigner {
  let pending = new Map<string, Waiter[]>()
  let scheduled = false

  async function flush(): Promise<void> {
    scheduled = false
    const batch = pending
    pending = new Map()
    const paths = [...batch.keys()]
    try {
      const urls =
        bucket === 'avatars'
          ? await backend.signAvatarPhotos(paths)
          : await backend.signCheckinPhotos(paths)
      for (const [path, waiters] of batch) {
        const url = urls[path]
        for (const waiter of waiters) {
          if (url) waiter.resolve(url)
          else waiter.reject(new BackendError('unknown', `No signed URL for ${path}`))
        }
      }
    } catch (error) {
      for (const waiters of batch.values()) for (const waiter of waiters) waiter.reject(error)
    }
  }

  return {
    sign(path) {
      return new Promise<string>((resolve, reject) => {
        const waiters = pending.get(path) ?? []
        waiters.push({ resolve, reject })
        pending.set(path, waiters)
        if (!scheduled) {
          scheduled = true
          setTimeout(() => void flush(), 0)
        }
      })
    },
  }
}

const signers = new WeakMap<BackendPort, Partial<Record<PhotoBucket, PhotoSigner>>>()

function signerFor(backend: BackendPort, bucket: PhotoBucket = 'checkins'): PhotoSigner {
  let byBucket = signers.get(backend)
  if (!byBucket) {
    byBucket = {}
    signers.set(backend, byBucket)
  }
  let signer = byBucket[bucket]
  if (!signer) {
    signer = createPhotoSigner(backend, bucket)
    byBucket[bucket] = signer
  }
  return signer
}

/** One path's signed-URL query: 10-minute URLs re-minted every 9, never persisted. */
function photoUrlQuery(signer: PhotoSigner, bucket: PhotoBucket, path: string, enabled: boolean) {
  return {
    queryKey: photoUrlKey(path, bucket),
    queryFn: () => signer.sign(path),
    enabled,
    staleTime: PHOTO_URL_REFRESH_MS,
    refetchInterval: PHOTO_URL_REFRESH_MS,
    gcTime: PHOTO_URL_GC_MS,
    retry: retryOnline(1),
    retryDelay: 500,
    meta: { persist: false, silentRefresh: true },
  }
}

interface NetworkInformationLike {
  saveData?: boolean
  effectiveType?: string
}

/** Save-Data and the link type, where the browser tells (`navigator.connection`). */
export function readConnectionHints(): ConnectionHints {
  const connection =
    typeof navigator === 'undefined'
      ? undefined
      : (navigator as Navigator & { connection?: NetworkInformationLike }).connection
  return {
    saveData: connection?.saveData === true,
    effectiveType: connection?.effectiveType ?? null,
  }
}

export interface PhotoUrlOptions {
  /** A 52 px or 104 px box: the 360 rendition only. */
  small?: boolean
  /** Only the 360 rendition is left. */
  fullPrunedAt?: string | null
}

export interface PhotoSource {
  /** The `src`, or null while the first URL is being signed. */
  src: string | null
  /** `360w` / `1080w` candidates, when both renditions are used. */
  srcSet: string | undefined
  /** The URL is the token-less one (offline): a load error means "not in the cache". */
  fromCache: boolean
  /** Signing failed while online. */
  failed: boolean
  /** Signs again (Retry). */
  retry: () => void
}

/**
 * The URLs of one check-in photo box. Small boxes, a pruned 1080, Save-Data and 2g links use the 360
 * rendition only; otherwise `src` is the 360 and `srcSet` offers both.
 */
export function usePhotoUrl(
  groupId: string,
  checkinId: string,
  options: PhotoUrlOptions = {},
): PhotoSource {
  const { backend } = useBackendContext('usePhotoUrl')
  const online = useOnline()
  const [hints] = useState(readConnectionHints)
  const mode = photoRenditions({
    small: options.small ?? false,
    fullPruned: Boolean(options.fullPrunedAt),
    hints,
  })
  const small = checkinPhotoPath(groupId, checkinId, 360)
  const full = checkinPhotoPath(groupId, checkinId, 1080)
  const paths = mode === 'small' ? [small] : [small, full]
  const signer = signerFor(backend)

  const results = useQueries({
    queries: paths.map((path) => photoUrlQuery(signer, 'checkins', path, online)),
  })

  const retry = () => {
    for (const result of results) void result.refetch()
  }
  const [small360, full1080] = results

  if (online && results.every((result) => result.data !== undefined)) {
    return {
      src: small360?.data ?? null,
      srcSet:
        small360?.data && full1080?.data
          ? `${small360.data} 360w, ${full1080.data} 1080w`
          : undefined,
      fromCache: false,
      failed: false,
      retry,
    }
  }
  // The 360 signed but the 1080 was refused: the 360 alone still shows the photo.
  if (online && small360?.data && full1080?.isError) {
    return { src: small360.data, srcSet: undefined, fromCache: false, failed: false, retry }
  }
  // Offline, or signing never reached the server: try the service worker's cached copy, with the
  // same candidates as online so the browser asks for the size it loaded (and cached) then.
  // `CheckinPhoto` falls back to the 360 alone when that misses.
  const unreachable = results.some(
    (result) => result.isError && backendErrorCode(result.error) === 'network',
  )
  if (!online || unreachable) {
    const cachedSmall = backend.checkinPhotoCacheUrl(small)
    return {
      src: cachedSmall,
      srcSet:
        mode === 'small'
          ? undefined
          : `${cachedSmall} 360w, ${backend.checkinPhotoCacheUrl(full)} 1080w`,
      fromCache: true,
      failed: false,
      retry,
    }
  }
  const failed = results.some((result) => result.isError)
  return { src: null, srcSet: undefined, fromCache: false, failed, retry }
}

/**
 * A profile photo's signed URL (Story 3.6), from bucket `avatars` through the same batched signer
 * and query options as check-in photos. Null without a path, while signing, after a failure and
 * offline (the service worker caches only check-in photos): the Avatar then shows the initial.
 */
export function useAvatarUrl(path: string | null): string | null {
  const { backend } = useBackendContext('useAvatarUrl')
  const online = useOnline()
  const signer = signerFor(backend, 'avatars')
  const { data } = useQuery(photoUrlQuery(signer, 'avatars', path ?? '', online && path !== null))
  return online && path !== null && data ? data : null
}
