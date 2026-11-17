import { act, fireEvent, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AuthError } from '@/domain/auth'
import { NEXT_KEY, SIGNIN_KEY } from '@/data/pending-signin'
import { createFakeBackend, renderRoutes, stubInstalled } from '@/test/fake-backend'

// Installed device: a sign-in goes straight on (the install guide has its own tests).
beforeEach(() => stubInstalled())

const T0 = new Date(2026, 10, 17, 9, 0, 0).getTime()

function storePending(sentAt: number, email = 'jo@example.com') {
  sessionStorage.setItem(SIGNIN_KEY, JSON.stringify({ email, sentAt }))
}

async function openCode(backend = createFakeBackend(null)) {
  const result = renderRoutes(['/signin/code'], backend)
  await screen.findByRole('heading', { level: 1, name: 'Check your email.' })
  return result
}

describe('CodeScreen', () => {
  beforeEach(() => {
    // Real setTimeout keeps Testing Library's waitFor/findBy polling working.
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] })
    vi.setSystemTime(T0)
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('reads email and send time from sessionStorage (reload-safe) and shows the one code field', async () => {
    storePending(T0)
    await openCode()
    expect(screen.getByText(/We sent a 6-digit code to/)).toHaveTextContent(
      'We sent a 6-digit code to jo@example.com.',
    )
    const field = screen.getByLabelText('6-digit code')
    expect(field).toHaveAttribute('inputmode', 'numeric')
    expect(field).toHaveAttribute('autocomplete', 'one-time-code')
    expect(field).toHaveAttribute('maxlength', '6')
    expect(screen.getAllByRole('textbox')).toHaveLength(1)
    expect(screen.getByText('Expires in 15 min')).toBeInTheDocument()
  })

  it('without a pending sign-in, goes back to /signin', async () => {
    const { router } = renderRoutes(['/signin/code'], createFakeBackend(null))
    await vi.waitFor(() => expect(router.state.location.pathname).toBe('/signin'))
  })

  it('counts "Resend code" down from 30 s, ignores taps until 0, then resends', async () => {
    storePending(T0)
    const { backend } = await openCode()

    const resend = screen.getByRole('button', { name: 'Resend code in 30s' })
    expect(resend).not.toBeDisabled()
    expect(resend).toHaveAttribute('aria-disabled', 'true')

    act(() => vi.advanceTimersByTime(7000))
    expect(screen.getByRole('button', { name: 'Resend code in 23s' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Resend code in 23s' }))
    expect(backend.sendEmailCode).not.toHaveBeenCalled()

    act(() => vi.advanceTimersByTime(23_000))
    const ready = screen.getByRole('button', { name: 'Resend code' })
    expect(ready).not.toHaveAttribute('aria-disabled')
    await act(async () => {
      fireEvent.click(ready)
    })
    expect(backend.sendEmailCode).toHaveBeenCalledWith(
      'jo@example.com',
      `${window.location.origin}/signin?next=%2Ftoday`,
    )
    // The new send restarts the countdown and the stored send time.
    expect(screen.getByRole('button', { name: 'Resend code in 30s' })).toBeInTheDocument()
    expect(JSON.parse(sessionStorage.getItem(SIGNIN_KEY) ?? '{}').sentAt).toBe(T0 + 30_000)
  })

  it('a correct code signs in and routes to the pending next, then clears it', async () => {
    storePending(T0)
    sessionStorage.setItem(NEXT_KEY, '/board?g=abc')
    const { router, backend } = await openCode()

    await act(async () => {
      fireEvent.change(screen.getByLabelText('6-digit code'), { target: { value: '123456' } })
    })
    expect(backend.verifyEmailCode).toHaveBeenCalledWith('jo@example.com', '123456')
    await vi.waitFor(() => expect(router.state.location.pathname).toBe('/board'))
    expect(router.state.location.search).toBe('?g=abc')
    expect(sessionStorage.getItem(NEXT_KEY)).toBeNull()
  })

  it('accepts a pasted code with spaces', async () => {
    storePending(T0)
    const { backend } = await openCode()
    await act(async () => {
      fireEvent.paste(screen.getByLabelText('6-digit code'), {
        clipboardData: { getData: () => '123 456' },
      })
    })
    expect(backend.verifyEmailCode).toHaveBeenCalledWith('jo@example.com', '123456')
  })

  it('a code rejected within 15 min reads "doesn\'t match"; the code is kept and focused', async () => {
    storePending(T0)
    const backend = createFakeBackend(null)
    backend.verifyEmailCode = vi.fn(async () => {
      throw new AuthError('code_rejected')
    })
    await openCode(backend)
    vi.setSystemTime(T0 + 14 * 60_000 + 59_000)

    const field = screen.getByLabelText('6-digit code')
    await act(async () => {
      fireEvent.change(field, { target: { value: '111111' } })
    })
    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent("That code doesn't match. Use the newest email.")
    expect(field).toHaveValue('111111')
    expect(field).toHaveAttribute('aria-describedby', alert.id)
    expect(field).toHaveFocus()
    expect(screen.queryByRole('button', { name: 'Send a new one' })).not.toBeInTheDocument()

    fireEvent.change(field, { target: { value: '11111' } })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('a code rejected from 15:00 on reads "That code expired." with Send a new one', async () => {
    storePending(T0)
    const backend = createFakeBackend(null)
    backend.verifyEmailCode = vi.fn(async () => {
      throw new AuthError('code_rejected')
    })
    await openCode(backend)
    act(() => vi.advanceTimersByTime(15 * 60_000))

    await act(async () => {
      fireEvent.change(screen.getByLabelText('6-digit code'), { target: { value: '222222' } })
    })
    expect(screen.getByRole('alert')).toHaveTextContent('That code expired.')
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Send a new one' }))
    })
    expect(backend.sendEmailCode).toHaveBeenCalledTimes(1)
  })

  it('offline shows the offline Field error without calling the backend', async () => {
    storePending(T0)
    const { backend } = await openCode()
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false })
    try {
      await act(async () => {
        fireEvent.change(screen.getByLabelText('6-digit code'), { target: { value: '123456' } })
      })
      expect(screen.getByRole('alert')).toHaveTextContent("You're offline. Connect to sign in.")
      expect(backend.verifyEmailCode).not.toHaveBeenCalled()
    } finally {
      Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => true })
    }
  })

  it('"Use a different email" goes back to /signin with the email filled in', async () => {
    vi.useRealTimers()
    storePending(Date.now())
    const user = userEvent.setup()
    const { router } = await openCode()
    await user.click(screen.getByRole('button', { name: 'Use a different email' }))
    await vi.waitFor(() => expect(router.state.location.pathname).toBe('/signin'))
    expect(screen.getByLabelText('Email')).toHaveValue('jo@example.com')
  })
})
