import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react'
import { Dialog } from 'radix-ui'
import { X } from '@phosphor-icons/react'
import { Button } from '@/ui/button'
import { IconButton } from '@/ui/icon-button'
import { cn } from '@/ui/lib/utils'
import { claimSheet, releaseSheet, repushSheetEntry, type SheetHandle } from '@/ui/sheet-history'

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

/** Downward drag distance (px) on the grabber/header that closes the sheet. */
const SWIPE_CLOSE_PX = 80

export interface SheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  children: ReactNode
  /** Optional description, linked with aria-describedby. */
  description?: ReactNode
  /** The sheet holds unsaved input: closing asks "Discard this?" first. */
  dirty?: boolean
  /**
   * Where focus returns on close, asked at close time: for a sheet that replaces another one (the
   * opener is not what has focus as it opens), or an opener that may be gone by then. Default: the
   * element focused when the sheet opened.
   */
  returnFocusTo?: () => HTMLElement | null
  className?: string
}

/**
 * Bottom sheet on Radix Dialog, restyled per DESIGN.md `sheet`. Closes by the close button, Esc,
 * system back, swipe down on the grabber or header, or a scrim tap. Focus is trapped and returns to
 * the trigger. Only one sheet is open at a time. It just appears (no slide), per the motion budget.
 * Focus starts on `[data-autofocus]` inside the content, else the first content control.
 */
export function Sheet({
  open,
  onOpenChange,
  title,
  children,
  description,
  dirty = false,
  returnFocusTo,
  className,
}: SheetProps) {
  const [confirming, setConfirming] = useState(false)
  const contentRef = useRef<HTMLDivElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const keepRef = useRef<HTMLButtonElement>(null)
  const returnFocusRef = useRef<HTMLElement | null>(null)
  const dragStartY = useRef<number | null>(null)
  const dragDistance = useRef(0)

  // Latest props for the history handle, which lives across renders.
  const latest = useRef({ dirty, onOpenChange, confirming, keep: () => {} })
  useEffect(() => {
    latest.current = { dirty, onOpenChange, confirming, keep }
  })

  const [handle] = useState<SheetHandle>(() => ({
    forceClose: () => latest.current.onOpenChange(false),
    onPop: () => {
      const { dirty: isDirty, confirming: isConfirming } = latest.current
      // Back while "Discard this?" shows means Keep; back with unsaved input asks first.
      // Either way the sheet stays open, so its history entry goes back on.
      if (isConfirming) {
        repushSheetEntry(handle)
        latest.current.keep()
        return
      }
      if (isDirty) {
        repushSheetEntry(handle)
        setConfirming(true)
        return
      }
      latest.current.onOpenChange(false)
    },
  }))

  useEffect(() => {
    if (!open) return
    claimSheet(handle)
    return () => {
      releaseSheet(handle)
      setConfirming(false)
    }
  }, [open, handle])

  useEffect(() => {
    if (confirming) keepRef.current?.focus()
  }, [confirming])

  function close() {
    setConfirming(false)
    onOpenChange(false)
  }

  /** Every close path except the Discard button. While "Discard this?" shows, it acts as Keep. */
  function requestClose() {
    if (confirming) {
      keep()
      return
    }
    if (dirty) {
      setConfirming(true)
      return
    }
    close()
  }

  function keep() {
    setConfirming(false)
    // Back to where the member was typing.
    requestAnimationFrame(() => {
      const target =
        bodyRef.current?.querySelector<HTMLElement>('[data-autofocus]') ??
        bodyRef.current?.querySelector<HTMLElement>(FOCUSABLE)
      ;(target ?? contentRef.current)?.focus()
    })
  }

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if ((event.target as HTMLElement).closest('button, a, input, textarea, select')) return
    dragStartY.current = event.clientY
    dragDistance.current = 0
    event.currentTarget.setPointerCapture?.(event.pointerId)
  }

  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (dragStartY.current === null) return
    dragDistance.current = Math.max(0, event.clientY - dragStartY.current)
    // Direct manipulation: the sheet follows the finger (not an animation).
    if (contentRef.current) {
      contentRef.current.style.transform = `translateY(${dragDistance.current}px)`
    }
  }

  function onPointerEnd() {
    if (dragStartY.current === null) return
    dragStartY.current = null
    if (contentRef.current) contentRef.current.style.transform = ''
    if (dragDistance.current >= SWIPE_CLOSE_PX) requestClose()
    dragDistance.current = 0
  }

  /** A cancelled drag (scroll took over, system gesture) never closes the sheet. */
  function onPointerCancel() {
    dragStartY.current = null
    dragDistance.current = 0
    if (contentRef.current) contentRef.current.style.transform = ''
  }

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) requestClose()
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-(--z-scrim) bg-scrim" data-sheet-scrim="" />
        <Dialog.Content
          ref={contentRef}
          {...(description ? {} : { 'aria-describedby': undefined })}
          onOpenAutoFocus={(event) => {
            event.preventDefault()
            // No Dialog.Trigger here, so remember the opener ourselves to return focus to it.
            returnFocusRef.current = document.activeElement as HTMLElement | null
            const target =
              bodyRef.current?.querySelector<HTMLElement>('[data-autofocus]') ??
              bodyRef.current?.querySelector<HTMLElement>(FOCUSABLE)
            ;(target ?? contentRef.current)?.focus()
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            const opener = returnFocusTo ? returnFocusTo() : returnFocusRef.current
            returnFocusRef.current = null
            if (opener?.isConnected) opener.focus()
          }}
          className={cn(
            'fixed inset-x-0 bottom-0 z-(--z-sheet) mx-auto flex max-h-[calc(100dvh-env(safe-area-inset-top)-var(--spacing-4))] w-full max-w-content-max flex-col overflow-y-auto overscroll-contain',
            'rounded-sheet border-[2.5px] border-b-0 border-line bg-card text-ink outline-none',
            'pr-[max(var(--spacing-gutter),env(safe-area-inset-right))] pb-[calc(var(--spacing-4)+env(safe-area-inset-bottom))] pl-[max(var(--spacing-gutter),env(safe-area-inset-left))]',
            className,
          )}
        >
          <div
            className="touch-none pt-2"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerEnd}
            onPointerCancel={onPointerCancel}
            data-sheet-drag=""
          >
            <div aria-hidden="true" className="mx-auto h-[5px] w-[44px] rounded-full bg-muted" />
            <div className="mt-2 mb-3 flex items-center justify-between gap-3">
              <Dialog.Title className="min-w-0 flex-1 type-headline">{title}</Dialog.Title>
              <IconButton icon={X} label="Close" onClick={requestClose} />
            </div>
          </div>
          {description ? (
            <Dialog.Description className="mb-3 type-body-sm text-muted">
              {description}
            </Dialog.Description>
          ) : null}

          {confirming ? (
            <div className="flex flex-col gap-4 py-2">
              <p className="type-title">Discard this?</p>
              <div className="flex flex-wrap gap-3">
                <Button ref={keepRef} variant="ghost" className="flex-1" onClick={keep}>
                  Keep
                </Button>
                <Button variant="primary" className="flex-1" onClick={close}>
                  Discard
                </Button>
              </div>
            </div>
          ) : null}
          {/* Hidden, not unmounted, while confirming, so typed input survives Keep. */}
          <div ref={bodyRef} hidden={confirming}>
            {children}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
