import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import type { CameraTarget } from '@/domain/camera'
import { targetTitle, type CheckinTarget } from '@/domain/checkin'
import type { CheckinPhoto } from '@/data/checkin'
import type { FirstAttempt } from '@/data/checkin-outbox'
import { CheckinPreview } from '@/features/checkin/checkin-preview'
import { TargetPicker } from '@/features/checkin/target-picker'

/** Where the flow is: the snap-first picker, the preview, or "Discard this photo?" over it. */
export type CheckinStep = 'picker' | 'preview' | 'confirm'

export interface CheckinFlowProps {
  /** The shot: the 4:3 canvas and its capture time. */
  photo: CheckinPhoto
  /** The row's pre-picked target; null = snap-first (the picker comes first). */
  target: CameraTarget | null
  /** The focused group, for the snap-first picker; null when the member has none. */
  groupId: string | null
  /** Filled with the flow's back step, for Close camera, Esc and system back in the overlay. */
  backRef: RefObject<(() => void) | null>
  /** The step changed (the overlay renews its CloseWatcher). */
  onStepChange: (step: CheckinStep) => void
  /** Drop the shot and go back to the live viewfinder (picker closed, Retake). */
  onRetake: () => void
  /** "Discard this photo?" → Discard: close the camera. */
  onDiscard: () => void
  /** The photo is in the outbox and its first send settled (offline: at once). */
  onDone: (outcome: FirstAttempt) => void
}

function toCameraTarget(target: CheckinTarget, groupId: string): CameraTarget {
  return {
    groupId,
    commitmentId: target.commitmentId,
    kind: target.kind,
    title: targetTitle(target),
    presetKey: target.presetKey,
  }
}

/**
 * The check-in flow after the shutter (Story 3.2), drawn as a panel inside the camera overlay:
 * snap-first goes to the picker, a pre-picked target straight to the preview. One back step for
 * Close camera, Esc and system back: picker → live viewfinder (frame discarded), preview →
 * "Discard this photo?", the confirm → Keep. While a post is in flight back does nothing.
 */
export function CheckinFlow({
  photo,
  target: prePicked,
  groupId,
  backRef,
  onStepChange,
  onRetake,
  onDiscard,
  onDone,
}: CheckinFlowProps) {
  const [picked, setPicked] = useState<CameraTarget | null>(prePicked)
  const [confirming, setConfirming] = useState(false)
  const busy = useRef(false)
  const step: CheckinStep = picked === null ? 'picker' : confirming ? 'confirm' : 'preview'

  const back = useCallback(() => {
    if (step === 'picker') onRetake()
    else if (step === 'confirm') setConfirming(false)
    else if (!busy.current) setConfirming(true)
  }, [step, onRetake])

  useEffect(() => {
    backRef.current = back
    return () => {
      backRef.current = null
    }
  }, [back, backRef])

  useEffect(() => {
    onStepChange(step)
  }, [step, onStepChange])

  const onBusyChange = useCallback((next: boolean) => {
    busy.current = next
  }, [])

  if (picked === null) {
    return (
      <TargetPicker
        canvas={photo.canvas}
        groupId={groupId}
        onPick={(target) => {
          if (groupId !== null) setPicked(toCameraTarget(target, groupId))
        }}
        onClose={onRetake}
      />
    )
  }

  return (
    <CheckinPreview
      photo={photo}
      target={picked}
      confirming={confirming}
      onRetake={onRetake}
      onRequestClose={back}
      onKeep={() => setConfirming(false)}
      onDiscard={onDiscard}
      onDone={onDone}
      onBusyChange={onBusyChange}
    />
  )
}
