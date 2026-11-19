import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { CUSTOM_ACTIVITY_ICON, presetIcon } from '@/domain/activities'
import { backendErrorCode } from '@/domain/error-codes'
import {
  changesNote,
  commitmentEditForm,
  isCommitmentEditDirty,
  MY_PLAN_COPY,
  toUpdateCommitmentInput,
  updatedToast,
  type CommitmentDetails,
  type CommitmentEditForm,
  type UpdateCommitmentInput,
} from '@/domain/my-plan'
import {
  DEFAULT_TARGET,
  endDateError,
  formatShortDate,
  lastWeekNote,
  PLAN_COPY,
  SCHEDULE_TYPE_OPTIONS,
  TARGET_MAX,
  TARGET_MIN,
  targetLabel,
  WEEKDAYS,
} from '@/domain/plan'
import { isOffline } from '@/data/connectivity'
import { useCommitment, usePlanPreview, useUpdateCommitment } from '@/data/plan'
import { Button } from '@/ui/button'
import { DateField } from '@/ui/date-field'
import { FieldError } from '@/ui/field-error'
import { Icon } from '@/ui/icon'
import { InlineRetry } from '@/ui/inline-retry'
import { SegmentedSwitch } from '@/ui/segmented-switch'
import { Skeleton, SkeletonBar, SkeletonBlock } from '@/ui/skeleton'
import { Stepper } from '@/ui/stepper'
import { showToast } from '@/ui/toast'
import { WeekdaySelector, type WeekdayOption } from '@/ui/weekday-selector'
import type { EndTarget } from '@/features/plan/end-commitment-sheet'

const WEEKDAY_OPTIONS: readonly WeekdayOption[] = WEEKDAYS.map((day) => ({
  value: day.iso,
  letter: day.letter,
  name: day.name,
}))

/** Why a save did not go through. Only offline and a plain failure offer Retry. */
type SaveFailure = 'offline' | 'failed' | 'ended'

function failureText(failure: SaveFailure): string {
  switch (failure) {
    case 'offline':
      return PLAN_COPY.offline
    case 'failed':
      return PLAN_COPY.failed
    case 'ended':
      return MY_PLAN_COPY.wrappedUp
  }
}

export interface CommitmentEditViewProps {
  groupId: string
  commitmentId: string
  onDirtyChange: (dirty: boolean) => void
  onSaved: () => void
  /** "End commitment": the host swaps this sheet for the End confirm. */
  onEnd: (commitment: EndTarget) => void
  /** The commitment is gone, ended or ending (the server says it can't be edited). */
  onUnavailable?: () => void
}

/**
 * The Plan sheet in commitment edit mode (Story 2.6), from `get_commitment`: the activity
 * read-only, the schedule type as its one locked segment with "Schedule type can't change while
 * this commitment is active. End it and add a new one.", the days or times per week and the end
 * date editable, and the start note "Changes start Mon 23 Nov." with the server's date. Save calls
 * `update_commitment` and shows "Gym changes to 4 times per week from Mon 23 Nov."; the destructive
 * "End commitment" link at the bottom opens the End confirm. A commitment the server says can't be
 * edited calls `onUnavailable` and shows "That's already wrapped up."
 */
export function CommitmentEditView({
  groupId,
  commitmentId,
  onDirtyChange,
  onSaved,
  onEnd,
  onUnavailable,
}: CommitmentEditViewProps) {
  const commitment = useCommitment(groupId, commitmentId)
  const details = commitment.data
  const unavailable =
    (details !== undefined && !details.canEdit) ||
    (details === undefined &&
      commitment.isError &&
      backendErrorCode(commitment.error) === 'not_found')

  // Reported once per open: the host closes the sheet and tells the member.
  const reported = useRef(false)
  useEffect(() => {
    if (unavailable && !reported.current) {
      reported.current = true
      onUnavailable?.()
    }
  }, [unavailable, onUnavailable])

  if (unavailable) {
    return <InlineRetry>{MY_PLAN_COPY.wrappedUp}</InlineRetry>
  }

  if (details) {
    return (
      <CommitmentEditForm
        groupId={groupId}
        details={details}
        onDirtyChange={onDirtyChange}
        onSaved={onSaved}
        onEnd={onEnd}
      />
    )
  }

  if (commitment.isError) {
    return (
      <InlineRetry onRetry={() => void commitment.refetch()} retryLabel={PLAN_COPY.retry}>
        {MY_PLAN_COPY.loadFailed}
      </InlineRetry>
    )
  }

  return (
    <Skeleton>
      <SkeletonBlock>
        <SkeletonBar />
        <SkeletonBar className="w-1/3" />
      </SkeletonBlock>
    </Skeleton>
  )
}

type ErrorKey = 'days' | 'endDate'

interface CommitmentEditFormProps {
  groupId: string
  details: CommitmentDetails
  onDirtyChange: (dirty: boolean) => void
  onSaved: () => void
  onEnd: (commitment: EndTarget) => void
}

function CommitmentEditForm({
  groupId,
  details,
  onDirtyChange,
  onSaved,
  onEnd,
}: CommitmentEditFormProps) {
  const update = useUpdateCommitment(groupId)
  const fixed = details.scheduleType === 'fixed_days'

  const [form, setForm] = useState<CommitmentEditForm>(() =>
    commitmentEditForm(details, DEFAULT_TARGET),
  )
  const [shown, setShown] = useState<ReadonlySet<ErrorKey>>(new Set())
  // The server refused the end date; cleared by the next end date change.
  const [serverEndDateError, setServerEndDateError] = useState(false)
  const [failure, setFailure] = useState<SaveFailure | null>(null)
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const lastInput = useRef<UpdateCommitmentInput | null>(null)
  const mounted = useRef(true)
  const [focusTick, setFocusTick] = useState(0)
  const [focusKey, setFocusKey] = useState<ErrorKey | null>(null)

  const daysRef = useRef<HTMLButtonElement>(null)
  const endDateRef = useRef<HTMLInputElement>(null)

  const ids = useId()
  const scheduleLabelId = `${ids}-schedule`
  const daysLabelId = `${ids}-days`
  const daysErrorId = `${ids}-days-error`
  const targetLabelId = `${ids}-target`

  // Only for the pro-rated last week note; the dates come from get_commitment.
  const preview = usePlanPreview(groupId, fixed ? null : form.target, form.endDate)

  const validation: Partial<Record<ErrorKey, string>> = {}
  if (fixed && form.days.length === 0) validation.days = PLAN_COPY.pickDay
  if (form.endDate !== null && form.endDate < details.minEndDate) {
    validation.endDate = endDateError(details.minEndDate)
  }

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  useEffect(() => {
    onDirtyChange(isCommitmentEditDirty(form, details))
  }, [form, details, onDirtyChange])

  useEffect(() => {
    if (focusTick === 0 || focusKey === null) return
    if (focusKey === 'days') daysRef.current?.focus()
    else endDateRef.current?.focus()
  }, [focusTick, focusKey])

  function focusError(key: ErrorKey) {
    setFocusKey(key)
    setFocusTick((tick) => tick + 1)
  }

  /** Applies a change and drops the shown errors it fixed. */
  function change(patch: Partial<CommitmentEditForm>) {
    const next = { ...form, ...patch }
    setForm(next)
    // An edit makes the failed request stale: Retry must not save what the form no longer shows.
    setFailure(null)
    lastInput.current = null
    const keepServerEndDate = serverEndDateError && !('endDate' in patch)
    if ('endDate' in patch) setServerEndDateError(false)
    setShown((prev) => {
      const kept = [...prev].filter((key) => {
        if (key === 'days') return fixed && next.days.length === 0
        return (next.endDate !== null && next.endDate < details.minEndDate) || keepServerEndDate
      })
      return kept.length === prev.size ? prev : new Set(kept)
    })
  }

  function save(event?: FormEvent) {
    event?.preventDefault()
    if (busyRef.current) return
    const keys = (['days', 'endDate'] as const).filter((key) => validation[key] !== undefined)
    if (keys.length > 0) {
      setShown(new Set(keys))
      setFailure(null)
      const first = keys[0]
      if (first) focusError(first)
      return
    }
    // Nothing changed: nothing to save.
    if (!isCommitmentEditDirty(form, details)) {
      onSaved()
      return
    }
    void send(toUpdateCommitmentInput(details, form))
  }

  async function send(input: UpdateCommitmentInput) {
    if (busyRef.current) return
    lastInput.current = input
    if (isOffline()) {
      setFailure('offline')
      return
    }
    busyRef.current = true
    setBusy(true)
    setFailure(null)
    try {
      const result = await update.mutateAsync(input)
      // Saved even if the sheet was discarded meanwhile, so the toast always shows.
      showToast(updatedToast(details.activityName, input, result.changesFrom))
      if (!mounted.current) return
      // Stays busy while the sheet closes.
      onSaved()
    } catch (error) {
      busyRef.current = false
      if (!mounted.current) return
      setBusy(false)
      const code = backendErrorCode(error)
      if (code === 'network') setFailure('offline')
      else if (code === 'commitment_ended' || code === 'not_found') setFailure('ended')
      else if (code === 'invalid_end_date') {
        setServerEndDateError(true)
        setShown((prev) => new Set([...prev, 'endDate']))
        focusError('endDate')
      } else setFailure('failed')
    }
  }

  function retry() {
    if (lastInput.current) void send(lastInput.current)
  }

  const daysError = shown.has('days') ? validation.days : undefined
  const endDateText = shown.has('endDate')
    ? (validation.endDate ?? (serverEndDateError ? endDateError(details.minEndDate) : undefined))
    : undefined
  const lastWeek =
    !fixed && preview.data && !preview.isPlaceholderData ? preview.data.lastWeekTarget : null
  const lastWeekHint =
    lastWeek !== null && lastWeek < form.target ? lastWeekNote(lastWeek, form.target) : undefined
  const activityIcon =
    details.presetKey !== null ? presetIcon(details.presetKey) : CUSTOM_ACTIVITY_ICON
  const canRetry = failure === 'offline' || failure === 'failed'

  return (
    <form noValidate className="flex flex-col" onSubmit={save}>
      <div className="flex flex-col gap-5 pb-1">
        <div className="flex flex-col gap-2">
          <p className="type-label text-muted">{PLAN_COPY.activity}</p>
          <p className="flex items-center gap-2 type-body text-ink" data-read-only="">
            <Icon icon={activityIcon} size={24} />
            <span>{details.activityName}</span>
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <p id={scheduleLabelId} className="type-label text-muted">
            {PLAN_COPY.schedule}
          </p>
          <SegmentedSwitch
            options={SCHEDULE_TYPE_OPTIONS}
            value={details.scheduleType}
            onChange={() => {}}
            labelledBy={scheduleLabelId}
            locked
            lockedNote={MY_PLAN_COPY.lockNote}
          />
        </div>

        {fixed ? (
          <div className="flex flex-col gap-2">
            <p id={daysLabelId} className="type-label text-muted">
              {PLAN_COPY.days}
            </p>
            <WeekdaySelector
              ref={daysRef}
              days={WEEKDAY_OPTIONS}
              value={form.days}
              onChange={(days) => change({ days })}
              labelledBy={daysLabelId}
              describedBy={daysError ? daysErrorId : undefined}
              invalid={daysError !== undefined}
            />
            {daysError ? <FieldError id={daysErrorId}>{daysError}</FieldError> : null}
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <p id={targetLabelId} className="type-label text-muted">
              {PLAN_COPY.timesPerWeek}
            </p>
            <Stepper
              value={form.target}
              onChange={(target) => change({ target })}
              min={TARGET_MIN}
              max={TARGET_MAX}
              unit={PLAN_COPY.unit}
              valueLabel={targetLabel}
              decrementLabel={PLAN_COPY.fewer}
              incrementLabel={PLAN_COPY.more}
              labelledBy={targetLabelId}
            />
          </div>
        )}

        <DateField
          ref={endDateRef}
          label={PLAN_COPY.endDate}
          value={form.endDate}
          displayValue={form.endDate ? formatShortDate(form.endDate) : ''}
          emptyText={PLAN_COPY.noEndDate}
          min={details.minEndDate}
          onChange={(endDate) => change({ endDate })}
          clearLabel={PLAN_COPY.clearEndDate}
          hint={lastWeekHint}
          error={endDateText}
        />

        <p className="type-meta text-muted" data-start-note="">
          {changesNote(details.changesFrom)}
        </p>
      </div>

      <div className="sticky bottom-0 flex flex-col gap-3 bg-card pt-[14px]">
        {failure ? (
          <InlineRetry onRetry={canRetry ? retry : undefined} retryLabel={PLAN_COPY.retry}>
            {failureText(failure)}
          </InlineRetry>
        ) : null}
        <Button type="submit" variant="primary" fullWidth busy={busy} busyLabel={PLAN_COPY.saving}>
          {PLAN_COPY.save}
        </Button>
        <Button
          variant="link"
          className="self-center text-miss"
          onClick={() => onEnd({ commitmentId: details.commitmentId, name: details.activityName })}
        >
          {MY_PLAN_COPY.endCommitment}
        </Button>
      </div>
    </form>
  )
}
