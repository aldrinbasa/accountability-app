import { useEffect, useRef, useState, type FormEvent } from 'react'
import { JOIN_COPY, normalizeInviteCode } from '@/domain/groups'
import { Button } from '@/ui/button'
import { TextField } from '@/ui/text-field'

export interface JoinCodeFormProps {
  /** A non-empty code, trimmed and upper-cased. The caller opens `/join/{code}`. */
  onCode: (code: string) => void
  /** Whether the field holds typed text (a Sheet asks "Discard this?" then). */
  onDirtyChange?: (dirty: boolean) => void
}

/**
 * The join part of the create screen and sheet: an "or" divider, "Got an invite code?", the
 * "Invite code" field and a secondary "Join with a code" button. An empty code is a Field error.
 */
export function JoinCodeForm({ onCode, onDirtyChange }: JoinCodeFormProps) {
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [focusTick, setFocusTick] = useState(0)
  const fieldRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (focusTick > 0) fieldRef.current?.focus()
  }, [focusTick])

  function submit(event: FormEvent) {
    event.preventDefault()
    const value = normalizeInviteCode(fieldRef.current?.value ?? code)
    if (value === '') {
      setError(JOIN_COPY.codeRequired)
      setFocusTick((tick) => tick + 1)
      return
    }
    onCode(value)
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2.5 type-label text-muted" aria-hidden="true">
        <span className="flex-1 border-t-2 border-dashed border-line/35" />
        {JOIN_COPY.or}
        <span className="flex-1 border-t-2 border-dashed border-line/35" />
      </div>
      <form noValidate className="flex flex-col gap-4" onSubmit={submit}>
        <h2 className="type-title-sm">{JOIN_COPY.codeHeading}</h2>
        <TextField
          ref={fieldRef}
          label={JOIN_COPY.codeLabel}
          name="invite-code"
          autoComplete="off"
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          maxLength={32}
          value={code}
          className="tracking-[0.2em] font-extrabold"
          onChange={(event) => {
            setCode(event.target.value)
            setError(null)
            onDirtyChange?.(event.target.value.trim() !== '')
          }}
          error={error ?? undefined}
        />
        <Button type="submit" variant="secondary" fullWidth>
          {JOIN_COPY.joinWithCode}
        </Button>
      </form>
    </div>
  )
}
