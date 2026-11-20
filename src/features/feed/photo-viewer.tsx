import { useEffect, useRef, useState } from 'react'
import { Dialog } from 'radix-ui'
import { X } from '@phosphor-icons/react'
import {
  checkinAlt,
  checkinHeading,
  checkinLateLabel,
  checkinMeta,
  FEED_COPY,
  type FeedCheckin,
  type FeedViewer,
} from '@/domain/feed'
import { LateLabel } from '@/ui/late-label'
import { claimSheet, releaseSheet, type SheetHandle } from '@/ui/sheet-history'
import { CameraControl } from '@/features/camera/camera-overlay'
import { CheckinPhoto } from '@/features/feed/checkin-photo'

export interface PhotoViewerProps {
  /** The check-in shown; null when closed. */
  item: FeedCheckin | null
  viewer: FeedViewer
  onClose: () => void
  /** Where focus goes back on close (the polaroid's photo button). */
  returnFocusTo: () => HTMLElement | null
}

/**
 * Photo viewer (DESIGN.md `photo-viewer`): full screen on `camera-surface` above everything
 * (`--z-photo-viewer`), the photo contained, caption and meta on a solid panel below it, close as a
 * camera control top-left. Esc, system back (its own history entry, like a sheet) and close return
 * focus to the polaroid. No save, share, download or copy-link controls; the image blocks drag,
 * long-press callout and the context menu.
 */
export function PhotoViewer({ item, viewer, onClose, returnFocusTo }: PhotoViewerProps) {
  const open = item !== null
  const closeRef = useRef<HTMLButtonElement>(null)
  const latestClose = useRef(onClose)
  useEffect(() => {
    latestClose.current = onClose
  })
  const [handle] = useState<SheetHandle>(() => ({
    forceClose: () => latestClose.current(),
    onPop: () => latestClose.current(),
  }))

  useEffect(() => {
    if (!open) return
    claimSheet(handle)
    return () => releaseSheet(handle)
  }, [open, handle])

  const late = item ? checkinLateLabel(item) : null

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
    >
      <Dialog.Portal>
        {item ? (
          <Dialog.Content
            aria-describedby={undefined}
            onOpenAutoFocus={(event) => {
              event.preventDefault()
              closeRef.current?.focus()
            }}
            onCloseAutoFocus={(event) => {
              event.preventDefault()
              const opener = returnFocusTo()
              if (opener?.isConnected) opener.focus()
            }}
            // Full screen: there is no outside to tap.
            onPointerDownOutside={(event) => event.preventDefault()}
            onContextMenu={(event) => event.preventDefault()}
            className="fixed inset-0 z-(--z-photo-viewer) h-dvh bg-camera-surface text-camera-ink outline-none"
            data-component="photo-viewer"
          >
            <Dialog.Title className="sr-only">{checkinHeading(item, viewer)}</Dialog.Title>
            <div className="mx-auto flex h-full w-full max-w-content-max flex-col pt-[env(safe-area-inset-top)] pr-[env(safe-area-inset-right)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)]">
              <div className="flex px-gutter py-3">
                <CameraControl
                  icon={X}
                  label={FEED_COPY.close}
                  onClick={onClose}
                  buttonRef={closeRef}
                />
              </div>
              <div className="flex min-h-0 flex-1 items-center justify-center px-gutter">
                <div className="relative aspect-[4/3] max-h-full w-full overflow-hidden rounded-photo bg-linear-to-br from-ph1 to-ph2">
                  <CheckinPhoto item={item} alt={checkinAlt(item, viewer)} variant="viewer" />
                </div>
              </div>
              <div className="flex flex-col gap-1 bg-camera-surface px-gutter pt-3 pb-6">
                {item.caption ? <p className="break-words type-hand-lg">{item.caption}</p> : null}
                <p className="flex flex-wrap items-center gap-x-2 gap-y-1 type-meta">
                  <span>{checkinMeta(item, viewer)}</span>
                  {late ? <LateLabel text={late.text} spoken={late.spoken} /> : null}
                </p>
              </div>
            </div>
          </Dialog.Content>
        ) : null}
      </Dialog.Portal>
    </Dialog.Root>
  )
}
