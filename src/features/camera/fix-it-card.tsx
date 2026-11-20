import { useId, type Ref } from 'react'
import { CAMERA_COPY, cameraPlatform, fixItSteps } from '@/domain/camera'
import { Button } from '@/ui/button'

/**
 * Fix-it card (DESIGN.md `fix-it-card`): a taped yellow sticky on the camera surface.
 * - `denied`: "Camera's blocked", the numbered steps for this platform and Try again (Primary on
 *   object), which re-requests the stream. No gallery fallback.
 * - `no_camera`: "No camera found." / "Check-ins need a camera. Try on your phone." and Close.
 */
export function FixItCard({
  variant,
  onTryAgain,
  onClose,
  actionRef,
}: {
  variant: 'denied' | 'no_camera'
  onTryAgain: () => void
  onClose: () => void
  /** The card's one action, so the overlay can focus it. */
  actionRef?: Ref<HTMLButtonElement>
}) {
  const headingId = useId()
  const steps = variant === 'denied' ? fixItSteps(cameraPlatform(navigator.userAgent)) : []
  return (
    <section
      aria-labelledby={headingId}
      className="on-object relative mx-auto flex w-full max-w-[340px] -rotate-1 flex-col gap-3 rounded-sticky bg-sticky px-5 pt-6 pb-5 text-obj-ink shadow-sticky"
      data-component="fix-it-card"
      data-variant={variant}
    >
      <span
        aria-hidden="true"
        className="absolute -top-3 left-1/2 h-6 w-24 -translate-x-1/2 rotate-2 bg-tape1"
      />
      <h2 id={headingId} className="type-headline">
        {variant === 'denied' ? CAMERA_COPY.deniedHeading : CAMERA_COPY.noCameraHeading}
      </h2>
      {variant === 'denied' ? (
        <ol className="flex list-decimal flex-col gap-1 pl-5 type-body-sm">
          {steps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      ) : (
        <p className="type-body-sm">{CAMERA_COPY.noCameraBody}</p>
      )}
      {variant === 'denied' ? (
        <Button ref={actionRef} variant="primary-on-object" onClick={onTryAgain}>
          {CAMERA_COPY.tryAgain}
        </Button>
      ) : (
        <Button ref={actionRef} variant="on-object" onClick={onClose}>
          {CAMERA_COPY.closeAction}
        </Button>
      )}
    </section>
  )
}
