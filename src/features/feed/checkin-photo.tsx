import { useState, type MouseEvent, type Ref } from 'react'
import { FEED_COPY, type FeedCheckin } from '@/domain/feed'
import { useOnline } from '@/data/connectivity'
import { usePhotoUrl } from '@/data/photo-url'
import { InlineRetry } from '@/ui/inline-retry'
import { cn } from '@/ui/lib/utils'

/** The Feed polaroid's photo is about the column width less the inset; the viewer is full width. */
const POLAROID_SIZES = '(min-width: 480px) 428px, calc(100vw - 68px)'
const VIEWER_SIZES = '100vw'

export interface CheckinPhotoProps {
  item: Pick<FeedCheckin, 'groupId' | 'id' | 'fullPrunedAt'>
  alt: string
  /** `polaroid`: cover-fills the 4:3 box, opens the viewer on tap. `viewer`: contained. */
  variant: 'polaroid' | 'viewer'
  /** Load at once (the first polaroids); otherwise lazily. */
  eager?: boolean
  /** Polaroid only: the photo is a button that opens the Photo viewer. */
  onOpen?: (event: MouseEvent<HTMLButtonElement>) => void
  buttonRef?: Ref<HTMLButtonElement>
}

/** No long-press save sheet, no drag-out, no context menu (EXPERIENCE §6 Privacy). */
function blockContextMenu(event: MouseEvent) {
  event.preventDefault()
}

/**
 * A check-in photo from Storage (signed URL, or the service worker's copy offline). It fills a
 * positioned 4:3 box that carries the `ph1`→`ph2` gradient (the polaroid's photo box, the viewer's
 * frame), which shows while the URL is being signed. A failed load shows "Photo didn't load." +
 * Retry inside the frame; offline with no cached copy, "Loads when you're back online." (it loads
 * again once the device is back online).
 */
export function CheckinPhoto({
  item,
  alt,
  variant,
  eager = false,
  onOpen,
  buttonRef,
}: CheckinPhotoProps) {
  const source = usePhotoUrl(item.groupId, item.id, { fullPrunedAt: item.fullPrunedAt })
  const online = useOnline()
  // The src that failed to load; a new src (re-mint, back online) clears the error by itself.
  const [failedSrc, setFailedSrc] = useState<string | null>(null)
  const loadFailed = source.src !== null && failedSrc === source.src
  // Offline, the cached copy is tried with the online candidates first, then as the 360 alone.
  const [smallOnly, setSmallOnly] = useState(false)
  const srcSet = source.fromCache && smallOnly ? undefined : source.srcSet

  if (loadFailed && (source.fromCache || !online)) {
    return (
      <p
        className="absolute inset-0 grid place-items-center p-4 text-center type-body-sm text-obj-ink"
        data-photo-state="offline"
      >
        {FEED_COPY.photoOffline}
      </p>
    )
  }

  if (source.failed || loadFailed) {
    return (
      <InlineRetry
        onObject
        className="absolute inset-0"
        retryLabel={FEED_COPY.retry}
        onRetry={() => {
          setFailedSrc(null)
          source.retry()
        }}
      >
        {FEED_COPY.photoFailed}
      </InlineRetry>
    )
  }

  if (source.src === null) return null

  const image = (
    <img
      src={source.src}
      srcSet={srcSet}
      sizes={srcSet ? (variant === 'viewer' ? VIEWER_SIZES : POLAROID_SIZES) : undefined}
      alt={alt}
      // CORS mode, so the service worker can keep a readable copy for offline.
      crossOrigin="anonymous"
      loading={eager || variant === 'viewer' ? 'eager' : 'lazy'}
      decoding="async"
      draggable={false}
      onContextMenu={blockContextMenu}
      onError={() => {
        if (source.fromCache && srcSet) setSmallOnly(true)
        else setFailedSrc(source.src)
      }}
      className={cn(
        'size-full select-none [-webkit-touch-callout:none]',
        variant === 'viewer' ? 'object-contain' : 'object-cover',
      )}
    />
  )

  if (!onOpen) return image

  return (
    <button
      ref={buttonRef}
      type="button"
      onClick={onOpen}
      onContextMenu={blockContextMenu}
      className="on-object absolute inset-0 block size-full cursor-zoom-in [-webkit-touch-callout:none]"
    >
      {image}
    </button>
  )
}
