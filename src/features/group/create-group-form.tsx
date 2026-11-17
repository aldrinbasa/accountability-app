import { useEffect, useRef, useState, type FormEvent } from 'react'
import { errorCopy, isBackendError } from '@/domain/error-codes'
import { GROUP_COPY, GROUP_NAME_MAX, trimGroupName, validateGroupName } from '@/domain/groups'
import { useCreateGroup } from '@/data/groups'
import { Button } from '@/ui/button'
import { InlineRetry } from '@/ui/inline-retry'
import { TextField } from '@/ui/text-field'

type Failure = 'offline' | 'failed'

function isOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false
}

export interface CreateGroupFormProps {
  /** The group exists and `['groups', 'me']` has been refetched with it. */
  onCreated: (groupId: string) => void
  /** Whether the field holds typed text (a Sheet asks "Discard this?" then). */
  onDirtyChange?: (dirty: boolean) => void
  /** Focus the field on mount (the sheet swaps the list for this form in place). */
  focusOnMount?: boolean
}

/**
 * The "Group name" field and coral "Create a group" button, shared by the full-screen create screen
 * on Today and the create sheet from the switcher. An empty name is a Field error (no RPC); offline
 * or a failed create shows an Inline retry above the button and keeps the name. While saving the
 * button reads "Saving…" and ignores taps; after success it stays busy while the screen moves on.
 */
export function CreateGroupForm({
  onCreated,
  onDirtyChange,
  focusOnMount = false,
}: CreateGroupFormProps) {
  const createGroup = useCreateGroup()
  const [name, setName] = useState('')
  const [nameError, setNameError] = useState<string | null>(null)
  const [failure, setFailure] = useState<Failure | null>(null)
  const [busy, setBusy] = useState(false)
  // The guard itself: Retry and submit can race within one render.
  const busyRef = useRef(false)
  const [focusTick, setFocusTick] = useState(0)
  const nameRef = useRef<HTMLInputElement>(null)
  const mounted = useRef(false)

  useEffect(() => {
    mounted.current = true
    if (focusOnMount) nameRef.current?.focus()
    return () => {
      mounted.current = false
    }
    // Mount only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (focusTick > 0) nameRef.current?.focus()
  }, [focusTick])

  function failName(message: string) {
    setFailure(null)
    setNameError(message)
    setFocusTick((tick) => tick + 1)
  }

  async function submit(event?: FormEvent) {
    event?.preventDefault()
    if (busyRef.current) return
    // Read from the field itself, so Retry sends what is typed now.
    const value = trimGroupName(nameRef.current?.value ?? name)
    const invalid = validateGroupName(value)
    if (invalid) return failName(errorCopy(invalid))
    if (isOffline()) {
      setFailure('offline')
      return
    }

    busyRef.current = true
    setBusy(true)
    setNameError(null)
    setFailure(null)
    try {
      const groupId = await createGroup.mutateAsync(value)
      if (mounted.current) onCreated(groupId)
    } catch (error) {
      busyRef.current = false
      if (!mounted.current) return
      setBusy(false)
      const code = isBackendError(error) ? error.code : 'unknown'
      if (code === 'invalid_group_name') failName(errorCopy(code))
      else setFailure(code === 'network' ? 'offline' : 'failed')
    }
  }

  return (
    <form noValidate className="flex flex-col gap-4" onSubmit={(event) => void submit(event)}>
      <TextField
        ref={nameRef}
        label={GROUP_COPY.nameLabel}
        name="group-name"
        autoComplete="off"
        maxLength={GROUP_NAME_MAX}
        required
        data-autofocus=""
        value={name}
        onChange={(event) => {
          setName(event.target.value)
          setNameError(null)
          onDirtyChange?.(event.target.value.trim() !== '')
        }}
        error={nameError ?? undefined}
      />
      {failure ? (
        <InlineRetry onRetry={() => void submit()} retryLabel={GROUP_COPY.retry}>
          {failure === 'offline' ? GROUP_COPY.offline : GROUP_COPY.createFailed}
        </InlineRetry>
      ) : null}
      <Button type="submit" variant="primary" fullWidth busy={busy} busyLabel={GROUP_COPY.saving}>
        {GROUP_COPY.create}
      </Button>
    </form>
  )
}
