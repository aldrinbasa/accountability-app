import { useId, useRef, useState, type FormEvent } from 'react'
import {
  approvedToast,
  dayLine,
  effectLine,
  FREEZE_COPY,
  freezeFailure,
  freezeOptionKey,
  noScoreLine,
  REASON_MAX,
  reasonCounter,
  sessionLabel,
  validateReason,
  voteNote,
  type FreezeOption,
  type FreezeWhich,
  type RequestFreezeInput,
  type RequestFreezeResult,
} from '@/domain/freeze'
import { useInvalidateFreezeViews, useRequestFreeze } from '@/data/freeze'
import { canRetry, useSaveFlow } from '@/data/save-flow'
import { Button } from '@/ui/button'
import { InlineRetry } from '@/ui/inline-retry'
import { cn } from '@/ui/lib/utils'
import { SegmentedSwitch } from '@/ui/segmented-switch'
import { Sheet } from '@/ui/sheet'
import { TextField } from '@/ui/text-field'
import { showToast } from '@/ui/toast'

export interface FreezeSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  groupId: string
  /** The habit's or task's title ("Study"). */
  title: string
  /** The commitment's options from `my_freeze_options` (at least one). */
  options: readonly FreezeOption[]
  /** The pre-picked option (`freezeOptionKey`); default the first. */
  initialKey?: string | null
  /** Alone in the group: the note says it's approved right away. */
  solo: boolean
  /** Where focus goes on close. */
  returnFocusTo?: () => HTMLElement | null
}

/**
 * The Freeze sheet (Story 5.4), titled "Request freeze". A day freeze shows its pre-picked session
 * ("Study on Sat") or, with 2+ sessions (from My plan), a radio list ("Sat 29 Nov"); a times-per-week
 * freeze shows "This week / Last week" when the server lists both, the effect line ("Gym this week:
 * 3 → 2 times") and, at 0, "Gym will have no score this week.". Then the required Reason (max 80,
 * live counter), the vote note (solo: approved right away) and Send, which stays enabled: no reason
 * shows the Field error, focused. Offline and failure show Inline retry above Send with the reason
 * kept; a refusal closes the Sheet with an error toast and refetches. Closing with a typed reason
 * asks "Discard this?".
 */
export function FreezeSheet({
  open,
  onOpenChange,
  groupId,
  title,
  options,
  initialKey = null,
  solo,
  returnFocusTo,
}: FreezeSheetProps) {
  const request = useRequestFreeze(groupId)
  const refetch = useInvalidateFreezeViews(groupId)
  const reasonRef = useRef<HTMLInputElement>(null)
  const listId = useId()
  const [reason, setReason] = useState('')
  const [reasonError, setReasonError] = useState<string | null>(null)
  const [selectedKey, setSelectedKey] = useState<string | null>(initialKey)

  const selected =
    options.find((o) => freezeOptionKey(o) === selectedKey) ??
    options.find((o) => freezeOptionKey(o) === initialKey) ??
    options[0] ??
    null

  const flow = useSaveFlow<RequestFreezeInput, RequestFreezeResult>({
    run: (input) => request.mutateAsync(input),
    onSaved: (result, _input, live) => {
      showToast(
        result.status === 'approved' && selected
          ? approvedToast(title, selected)
          : FREEZE_COPY.requested,
      )
      if (live) close()
    },
    onError: (code) => {
      const failure = freezeFailure(code)
      if (failure.kind === 'reason') {
        setReasonError(FREEZE_COPY.reasonError)
        reasonRef.current?.focus()
        return null
      }
      if (failure.kind === 'refused') {
        showToast(failure.text, { variant: 'error' })
        refetch()
        close()
        return null
      }
      return 'failed'
    },
    active: open,
  })

  // Every open starts fresh: no reason, no failure, the pre-picked option.
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setReason('')
      setReasonError(null)
      setSelectedKey(initialKey)
      flow.setFailure(null)
    }
  }

  function close() {
    flow.setFailure(null)
    onOpenChange(false)
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    send()
  }

  /** Send and Retry: the current reason and pick (the reason may have changed since a failure). */
  function send() {
    if (!selected) return
    const error = validateReason(reason)
    if (error) {
      setReasonError(error)
      reasonRef.current?.focus()
      return
    }
    void flow.send({
      commitmentId: selected.commitmentId,
      reason: reason.trim(),
      sessionId: selected.kind === 'day' ? selected.sessionId : null,
      weekStart: selected.kind === 'week' ? selected.weekStart : null,
    })
  }

  const dayOptions = options.filter((o) => o.kind === 'day')
  const weekOptions = options.filter((o) => o.kind === 'week')
  const thisWeek = weekOptions.find((o) => o.which === 'this')
  const lastWeek = weekOptions.find((o) => o.which === 'last')
  const noScore = selected?.kind === 'week' ? noScoreLine(title, selected) : null

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => (next ? onOpenChange(true) : close())}
      title={FREEZE_COPY.sheetTitle}
      dirty={reason.length > 0}
      returnFocusTo={returnFocusTo}
    >
      <form className="flex flex-col gap-4" noValidate onSubmit={submit}>
        {selected?.kind === 'day' ? (
          dayOptions.length > 1 ? (
            <fieldset className="flex flex-col gap-2">
              <legend id={listId} className="mb-2 type-label text-muted">
                {`${title} · ${FREEZE_COPY.sessionLabel}`}
              </legend>
              {dayOptions.map((option) => {
                const key = freezeOptionKey(option)
                const checked = key === freezeOptionKey(selected)
                return (
                  <label
                    key={key}
                    className={cn(
                      'flex min-h-target-min items-center gap-3 rounded-wob-sm border-[2.5px] border-line px-3 type-body',
                      checked ? 'bg-paper' : 'bg-card',
                    )}
                  >
                    <input
                      type="radio"
                      name={listId}
                      value={key}
                      checked={checked}
                      onChange={() => setSelectedKey(key)}
                      className="size-5 accent-ink"
                    />
                    {sessionLabel(option.startsAt, option.timeZone)}
                  </label>
                )
              })}
            </fieldset>
          ) : (
            <p className="type-title" data-freeze-session="">
              {dayLine(title, selected)}
            </p>
          )
        ) : null}
        {selected?.kind === 'week' ? (
          <>
            {thisWeek && lastWeek ? (
              <SegmentedSwitch<FreezeWhich>
                label={FREEZE_COPY.weekLabel}
                options={[
                  { value: 'this', label: FREEZE_COPY.thisWeek },
                  { value: 'last', label: FREEZE_COPY.lastWeek },
                ]}
                value={selected.which}
                onChange={(which) => {
                  const next = which === 'this' ? thisWeek : lastWeek
                  setSelectedKey(freezeOptionKey(next))
                }}
              />
            ) : null}
            <div className="flex flex-col gap-1" data-freeze-effect="">
              <p className="type-title">{effectLine(title, selected)}</p>
              {noScore ? <p className="type-meta text-muted">{noScore}</p> : null}
            </div>
          </>
        ) : null}
        <TextField
          ref={reasonRef}
          label={FREEZE_COPY.reasonLabel}
          value={reason}
          maxLength={REASON_MAX}
          autoComplete="off"
          enterKeyHint="send"
          hint={reasonCounter(reason)}
          error={reasonError ?? undefined}
          onChange={(event) => {
            const next = event.target.value
            setReason(next)
            if (reasonError && validateReason(next) === null) setReasonError(null)
          }}
        />
        <p className="type-meta text-muted">{voteNote(solo)}</p>
        {flow.failure ? (
          <InlineRetry
            onRetry={canRetry(flow.failure) ? send : undefined}
            retryLabel={FREEZE_COPY.retry}
          >
            {flow.failure === 'offline' ? FREEZE_COPY.offline : FREEZE_COPY.failed}
          </InlineRetry>
        ) : null}
        <Button
          type="submit"
          variant="primary"
          fullWidth
          busy={flow.busy}
          busyLabel={FREEZE_COPY.sending}
        >
          {FREEZE_COPY.send}
        </Button>
      </form>
    </Sheet>
  )
}
