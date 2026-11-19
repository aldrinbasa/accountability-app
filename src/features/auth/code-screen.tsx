import { useEffect, useRef, useState, type ClipboardEvent, type FormEvent } from 'react'
import { Navigate, useNavigate } from 'react-router'
import { CODE_LENGTH, isAuthError, normalizeCode } from '@/domain/auth'
import { AUTH_COPY, codeErrorCopy, type CodeErrorCopy } from '@/domain/auth-errors'
import { signInRedirectUrl } from '@/domain/next-path'
import { useAuthActions } from '@/data/auth-session'
import {
  peekPendingNext,
  readPendingSignIn,
  savePendingSignIn,
  type PendingSignIn,
} from '@/data/pending-signin'
import { isOffline } from '@/data/connectivity'
import { Button } from '@/ui/button'
import { TextField } from '@/ui/text-field'
import { useResendCountdown } from '@/features/auth/use-resend-countdown'

/**
 * `/signin/code`: one field for the 6-digit code from the email (the path that works inside an
 * installed iOS app, where the link would open Safari). The email and send time come from
 * sessionStorage, so a reload keeps working; without them the member goes back to /signin.
 */
export function CodeScreen() {
  const [pending, setPending] = useState<PendingSignIn | null>(() => readPendingSignIn())
  if (!pending) return <Navigate to="/signin" replace />
  return <CodeForm pending={pending} onResent={setPending} />
}

function CodeForm({
  pending,
  onResent,
}: {
  pending: PendingSignIn
  onResent: (pending: PendingSignIn) => void
}) {
  const navigate = useNavigate()
  const actions = useAuthActions()
  const [code, setCode] = useState('')
  const [error, setError] = useState<CodeErrorCopy | null>(null)
  const [verifying, setVerifying] = useState(false)
  const [resending, setResending] = useState(false)
  const [focusTick, setFocusTick] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const secondsLeft = useResendCountdown(pending.sentAt)

  useEffect(() => {
    if (focusTick > 0) inputRef.current?.focus()
  }, [focusTick])

  function fail(message: string, offerResend = false) {
    setError({ message, offerResend })
    setFocusTick((tick) => tick + 1)
  }

  async function verify(value: string) {
    if (verifying) return
    if (value.length !== CODE_LENGTH) return fail(AUTH_COPY.codeWrong)
    if (isOffline()) return fail(AUTH_COPY.offline)
    setVerifying(true)
    setError(null)
    try {
      // On success the sign-in layout routes to the pending `next` path or /today.
      await actions.verifyEmailCode(pending.email, value)
    } catch (caught) {
      setVerifying(false)
      if (isAuthError(caught) && caught.code === 'code_rejected') {
        const copy = codeErrorCopy(pending.sentAt, Date.now())
        fail(copy.message, copy.offerResend)
      } else if (isAuthError(caught) && caught.code === 'network') {
        fail(AUTH_COPY.offline)
      } else {
        fail(AUTH_COPY.signInFailed)
      }
    }
  }

  async function resend() {
    if (secondsLeft > 0 || resending) return
    if (isOffline()) return fail(AUTH_COPY.offline)
    setResending(true)
    try {
      await actions.sendEmailCode(
        pending.email,
        signInRedirectUrl(window.location.origin, peekPendingNext()),
      )
      const next = { email: pending.email, sentAt: Date.now() }
      savePendingSignIn(next)
      setError(null)
      onResent(next)
    } catch (caught) {
      fail(
        isAuthError(caught) && caught.code === 'network' ? AUTH_COPY.offline : AUTH_COPY.sendFailed,
      )
    } finally {
      setResending(false)
    }
  }

  function update(raw: string) {
    const value = normalizeCode(raw)
    if (value === code) return
    setCode(value)
    setError(null)
    if (value.length === CODE_LENGTH) void verify(value)
  }

  function onPaste(event: ClipboardEvent<HTMLInputElement>) {
    // maxLength would cut "123 456" to "123 45" before onChange sees it, so read the paste here.
    event.preventDefault()
    update(event.clipboardData.getData('text'))
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    void verify(code)
  }

  const counting = secondsLeft > 0

  return (
    <div className="flex flex-col gap-6 pt-8">
      <div className="flex flex-col gap-2">
        <h1 tabIndex={-1} className="type-headline">
          Check your email.
        </h1>
        <p className="type-body">
          We sent a 6-digit code to <strong className="break-all">{pending.email}</strong>.
        </p>
      </div>

      <form noValidate className="flex flex-col gap-4" onSubmit={onSubmit}>
        <div className="flex flex-col gap-1">
          <TextField
            ref={inputRef}
            label="6-digit code"
            name="code"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={CODE_LENGTH}
            className="tracking-[0.3em] tabular-nums"
            value={code}
            onChange={(event) => update(event.target.value)}
            onPaste={onPaste}
            error={error?.message}
            errorAction={
              error?.offerResend ? (
                <Button variant="link" onClick={() => void resend()}>
                  {AUTH_COPY.sendNewOne}
                </Button>
              ) : undefined
            }
          />
          <p className="type-meta text-muted">Expires in 15 min</p>
        </div>
        <Button type="submit" variant="primary" fullWidth busy={verifying} busyLabel="Checking…">
          Sign in
        </Button>
      </form>

      <div className="flex flex-wrap items-center justify-between gap-2">
        {/* Never a greyed-out look: the label counts down and taps are ignored until it reaches 0. */}
        <Button
          variant="link"
          aria-disabled={counting || undefined}
          busy={resending}
          busyLabel="Sending…"
          onClick={() => void resend()}
          className="tabular-nums"
        >
          {counting ? `Resend code in ${secondsLeft}s` : 'Resend code'}
        </Button>
        <Button variant="link" onClick={() => void navigate('/signin', { replace: true })}>
          Use a different email
        </Button>
      </div>
    </div>
  )
}
