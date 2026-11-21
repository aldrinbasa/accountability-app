import { useId, useState, type FormEvent } from 'react'
import { errorCopy } from '@/domain/error-codes'
import {
  GOAL_COPY,
  GOAL_PERIOD_OPTIONS,
  GOAL_TARGET_DEFAULT,
  GOAL_TARGET_MAX,
  GOAL_TARGET_MIN,
  GOAL_TARGET_STEP,
  goalSavedToast,
  goalTargetLabel,
  type GoalPeriod,
} from '@/domain/goal'
import { useSetGroupGoal, type GoalInput } from '@/data/goal'
import { canRetry, useSaveFlow } from '@/data/save-flow'
import { Button } from '@/ui/button'
import { InlineRetry } from '@/ui/inline-retry'
import { SegmentedSwitch } from '@/ui/segmented-switch'
import { Sheet } from '@/ui/sheet'
import { Stepper } from '@/ui/stepper'
import { showToast } from '@/ui/toast'

/** The Sheet's own failures beyond offline and failed: refused for a reason Retry cannot fix. */
type GoalFailure = 'not_admin' | 'not_member' | 'invalid_goal'

export interface GoalSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  groupId: string
  /** The goal in effect now (Edit), or null (Set a group goal). */
  current: GoalInput | null
  /** Where focus goes on close (the opener may be gone by then). */
  returnFocusTo?: () => HTMLElement | null
}

/**
 * The admin's goal Sheet (Story 4.7, from the Board's Goal panel and group settings): a target
 * stepper (50-100 in steps of 5; the Stepper counts steps, so its value is the target / 5), a Weekly
 * / Monthly switch, the note and a full-width coral Save. Save reads "Saving…", then closes with the
 * toast "Goal set: 85% this week."; offline or a failure shows Inline retry above Save and keeps the
 * inputs; a refusal (`not_admin`, `invalid_goal`, `not_member`) shows the AD-14 copy without Retry.
 * Closing with changed inputs asks "Discard this?". Each open starts from the goal in effect.
 */
export function GoalSheet({ open, onOpenChange, groupId, current, returnFocusTo }: GoalSheetProps) {
  const start: GoalInput = current ?? { target: GOAL_TARGET_DEFAULT, period: 'weekly' }
  const [form, setForm] = useState<GoalInput>(start)
  const [wasOpen, setWasOpen] = useState(open)
  const save = useSetGroupGoal(groupId)
  const targetLabelId = useId()
  const periodLabelId = useId()

  const flow = useSaveFlow<GoalInput, void, GoalFailure>({
    run: (input) => save.mutateAsync(input),
    onSaved: (_result, input, live) => {
      showToast(goalSavedToast(input.target, input.period))
      if (live) onOpenChange(false)
    },
    onError: (code) =>
      code === 'not_admin' || code === 'not_member' || code === 'invalid_goal' ? code : 'failed',
    active: open,
  })

  // Every open starts from the goal in effect, without the last open's failure.
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setForm(start)
      flow.setFailure(null)
    }
  }

  const dirty = form.target !== start.target || form.period !== start.period

  function change(next: Partial<GoalInput>) {
    setForm((previous) => ({ ...previous, ...next }))
    // The failed request no longer matches what is on screen.
    flow.reset()
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    void flow.send(form)
  }

  function failureText(failure: NonNullable<typeof flow.failure>): string {
    if (failure === 'offline') return GOAL_COPY.offline
    if (failure === 'failed') return GOAL_COPY.failed
    return errorCopy(failure)
  }

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={current ? GOAL_COPY.sheetTitleEdit : GOAL_COPY.sheetTitleNew}
      dirty={dirty && !flow.busy}
      returnFocusTo={returnFocusTo}
    >
      <form noValidate className="flex flex-col" onSubmit={submit} data-component="goal-sheet">
        <div className="flex flex-col gap-5 pb-1">
          <div className="flex flex-col gap-2">
            <p id={targetLabelId} className="type-label text-muted">
              {GOAL_COPY.target}
            </p>
            <Stepper
              value={form.target / GOAL_TARGET_STEP}
              onChange={(steps) => change({ target: steps * GOAL_TARGET_STEP })}
              min={GOAL_TARGET_MIN / GOAL_TARGET_STEP}
              max={GOAL_TARGET_MAX / GOAL_TARGET_STEP}
              display={(steps) => `${steps * GOAL_TARGET_STEP}%`}
              unit=""
              valueLabel={(steps) => goalTargetLabel(steps * GOAL_TARGET_STEP)}
              decrementLabel={GOAL_COPY.lower}
              incrementLabel={GOAL_COPY.raise}
              labelledBy={targetLabelId}
            />
          </div>
          <div className="flex flex-col gap-2">
            <p id={periodLabelId} className="type-label text-muted">
              {GOAL_COPY.period}
            </p>
            <SegmentedSwitch
              options={GOAL_PERIOD_OPTIONS}
              value={form.period}
              onChange={(period: GoalPeriod) => change({ period })}
              labelledBy={periodLabelId}
            />
          </div>
          <p className="type-body-sm text-muted">{GOAL_COPY.note}</p>
        </div>
        <div className="sticky bottom-0 flex flex-col gap-3 bg-card pt-[14px]">
          {flow.failure ? (
            <InlineRetry
              onRetry={canRetry(flow.failure) ? () => void flow.retry() : undefined}
              retryLabel={GOAL_COPY.retry}
            >
              {failureText(flow.failure)}
            </InlineRetry>
          ) : null}
          <Button
            type="submit"
            variant="primary"
            fullWidth
            busy={flow.busy}
            busyLabel={GOAL_COPY.saving}
          >
            {GOAL_COPY.save}
          </Button>
        </div>
      </form>
    </Sheet>
  )
}
