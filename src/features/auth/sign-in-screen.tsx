import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { isAuthError, isValidEmail } from '@/domain/auth'
import { AUTH_COPY } from '@/domain/auth-errors'
import { signInRedirectUrl } from '@/domain/next-path'
import { useAuthActions } from '@/data/auth-session'
import {
  peekPendingNext,
  readPendingSignIn,
  savePendingNext,
  savePendingSignIn,
} from '@/data/pending-signin'
import { isOffline } from '@/data/connectivity'
import { Button } from '@/ui/button'
import { FieldError } from '@/ui/field-error'
import { TextField } from '@/ui/text-field'
import { GoogleButton } from '@/features/auth/google-button'
import { verifyOnce } from '@/features/auth/verify-once'

/** What a redirect back to /signin brought along (email link, Google return, Google error). */
interface Incoming {
  next: string | null
  tokenHash: string | null
  oauthCode: string | null
  oauthError: boolean
}

function readIncoming(search: string): Incoming | null {
  const params = new URLSearchParams(search)
  const incoming: Incoming = {
    next: params.get('next'),
    tokenHash:
      params.get('type') === 'email' || !params.get('type') ? params.get('token_hash') : null,
    oauthCode: params.get('code'),
    oauthError: params.has('error') || params.has('error_description'),
  }
  const hasAnything =
    incoming.next !== null || incoming.tokenHash || incoming.oauthCode || incoming.oauthError
  return hasAnything ? incoming : null
}

interface EmailError {
  message: string
  offerResend: boolean
}

/**
 * `/signin`: Google, or an email that gets a link plus a 6-digit code. Also the landing spot for the
 * email link (`?token_hash=`) and Google's return (`?code=` or `?error=`): it reads them once, wipes
 * them from the URL, and verifies them exactly once. Routing after sign-in belongs to the sign-in
 * layout in src/app, which sends a signed-in member to the pending `next` path or /today.
 */
export function SignInScreen() {
  const location = useLocation()
  const navigate = useNavigate()
  const actions = useAuthActions()
  const [incoming] = useState(() => readIncoming(location.search))

  const [email, setEmail] = useState(() => readPendingSignIn()?.email ?? '')
  const [emailError, setEmailError] = useState<EmailError | null>(null)
  const [googleError, setGoogleError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [googleBusy, setGoogleBusy] = useState(false)
  const [verifying, setVerifying] = useState(
    () => !!(incoming?.tokenHash || (incoming?.oauthCode && !incoming.oauthError)),
  )
  const [focusTick, setFocusTick] = useState(0)
  const emailRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (focusTick > 0) emailRef.current?.focus()
  }, [focusTick])

  // Read once, strip from the URL, verify once (StrictMode-safe through verifyOnce).
  useEffect(() => {
    if (!incoming) return
    let active = true
    if (incoming.next !== null) savePendingNext(incoming.next)
    void navigate({ pathname: location.pathname }, { replace: true })

    if (incoming.oauthError) {
      setGoogleError(AUTH_COPY.googleFailed)
    } else if (incoming.tokenHash) {
      const hash = incoming.tokenHash
      verifyOnce(`link:${hash}`, () => actions.verifyEmailLink(hash)).catch((error: unknown) => {
        if (!active) return
        setVerifying(false)
        if (isAuthError(error) && error.code === 'link_rejected') {
          setEmailError({ message: AUTH_COPY.codeExpired, offerResend: true })
          // Usually a new tab with no stored email: point the member at the empty field.
          if (!isValidEmail(readPendingSignIn()?.email ?? '')) setFocusTick((tick) => tick + 1)
        } else if (isAuthError(error) && error.code === 'network') {
          setEmailError({ message: AUTH_COPY.offline, offerResend: false })
        } else {
          setEmailError({ message: AUTH_COPY.signInFailed, offerResend: false })
        }
      })
    } else if (incoming.oauthCode) {
      const code = incoming.oauthCode
      verifyOnce(`oauth:${code}`, () => actions.exchangeOAuthCode(code)).catch(() => {
        if (!active) return
        setVerifying(false)
        setGoogleError(AUTH_COPY.googleFailed)
      })
    }
    return () => {
      active = false
    }
    // Runs once per mount, on the URL the screen opened with.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function failEmail(message: string, offerResend = false) {
    setEmailError({ message, offerResend })
    setFocusTick((tick) => tick + 1)
  }

  async function sendLinkAndCode(event?: FormEvent) {
    event?.preventDefault()
    if (sending) return
    const value = email.trim()
    if (!isValidEmail(value)) return failEmail(AUTH_COPY.invalidEmail)
    if (isOffline()) return failEmail(AUTH_COPY.offline)

    setSending(true)
    setEmailError(null)
    try {
      await actions.sendEmailCode(
        value,
        signInRedirectUrl(window.location.origin, peekPendingNext()),
      )
      savePendingSignIn({ email: value, sentAt: Date.now() })
      void navigate('/signin/code')
    } catch (error) {
      setSending(false)
      failEmail(
        isAuthError(error) && error.code === 'network' ? AUTH_COPY.offline : AUTH_COPY.sendFailed,
      )
    }
  }

  async function continueWithGoogle() {
    if (googleBusy) return
    setGoogleError(null)
    if (isOffline()) {
      setGoogleError(AUTH_COPY.offline)
      return
    }
    setGoogleBusy(true)
    try {
      // On success the browser leaves for Google, so the button stays busy.
      await actions.signInWithGoogle(signInRedirectUrl(window.location.origin, peekPendingNext()))
    } catch {
      setGoogleBusy(false)
      setGoogleError(AUTH_COPY.googleFailed)
    }
  }

  if (verifying) {
    return (
      <div className="flex flex-col gap-stack pt-8">
        <h1 tabIndex={-1} className="type-headline">
          Sign in to Proofy
        </h1>
        <p role="status" className="type-body">
          Signing you in…
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6 pt-8">
      <h1 tabIndex={-1} className="type-headline">
        Sign in to Proofy
      </h1>

      <div className="flex flex-col gap-2">
        <GoogleButton
          busy={googleBusy}
          onClick={() => void continueWithGoogle()}
          aria-describedby={googleError ? 'google-error' : undefined}
        />
        {googleError ? <FieldError id="google-error">{googleError}</FieldError> : null}
      </div>

      <p className="flex items-center gap-3 type-meta text-muted" aria-hidden="true">
        <span className="h-px flex-1 bg-line opacity-20" />
        or
        <span className="h-px flex-1 bg-line opacity-20" />
      </p>

      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(event) => void sendLinkAndCode(event)}
      >
        <TextField
          ref={emailRef}
          label="Email"
          type="email"
          name="email"
          autoComplete="email"
          inputMode="email"
          autoCapitalize="none"
          spellCheck={false}
          value={email}
          onChange={(event) => {
            setEmail(event.target.value)
            setEmailError(null)
          }}
          error={emailError?.message}
          errorAction={
            // "Send a new one" only when there is an address to send to; otherwise the empty
            // field (focused) is the way forward.
            emailError?.offerResend && isValidEmail(email) ? (
              <Button variant="link" onClick={() => void sendLinkAndCode()}>
                {AUTH_COPY.sendNewOne}
              </Button>
            ) : undefined
          }
        />
        <Button type="submit" variant="primary" fullWidth busy={sending} busyLabel="Sending…">
          Send code
        </Button>
      </form>
    </div>
  )
}
