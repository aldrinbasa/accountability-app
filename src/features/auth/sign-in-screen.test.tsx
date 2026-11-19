import { StrictMode } from 'react'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { AuthError } from '@/domain/auth'
import { NEXT_KEY, SIGNIN_KEY } from '@/data/pending-signin'
import { routes } from '@/app/router'
import { createFakeBackend, renderRoutes, stubInstalled, withBackend } from '@/test/fake-backend'

function setOnline(online: boolean) {
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => online })
}

// Installed device: a sign-in goes straight on (the install guide has its own tests).
beforeEach(() => stubInstalled())
afterEach(() => setOnline(true))

async function openSignIn(path = '/signin', backend = createFakeBackend(null)) {
  const result = renderRoutes([path], backend)
  await screen.findByRole('heading', { level: 1, name: 'Sign in to Proofy' })
  return result
}

describe('SignInScreen: start', () => {
  it('shows Continue with Google and the labelled email field with "Send code"', async () => {
    await openSignIn()
    expect(screen.getByRole('button', { name: 'Continue with Google' })).toBeInTheDocument()
    const email = screen.getByLabelText('Email')
    expect(email).toHaveAttribute('type', 'email')
    expect(email).toHaveAttribute('autocomplete', 'email')
    expect(screen.getByRole('button', { name: 'Send code' })).toBeInTheDocument()
  })
})

describe('SignInScreen: send', () => {
  it('sends a link and code, stores email + send time, and moves to /signin/code', async () => {
    const user = userEvent.setup()
    sessionStorage.setItem(NEXT_KEY, '/join/AB12CD')
    const { router, backend } = await openSignIn()

    await user.type(screen.getByLabelText('Email'), 'jo@example.com')
    await user.click(screen.getByRole('button', { name: 'Send code' }))

    expect(backend.sendEmailCode).toHaveBeenCalledWith(
      'jo@example.com',
      `${window.location.origin}/signin?next=%2Fjoin%2FAB12CD`,
    )
    await vi.waitFor(() => expect(router.state.location.pathname).toBe('/signin/code'))
    const stored = JSON.parse(sessionStorage.getItem(SIGNIN_KEY) ?? 'null')
    expect(stored.email).toBe('jo@example.com')
    expect(typeof stored.sentAt).toBe('number')
    expect(
      await screen.findByText(/We sent a 6-digit code to/, { exact: false }),
    ).toHaveTextContent('We sent a 6-digit code to jo@example.com.')
  })

  it('an invalid email shows the Field error, linked and focused, cleared on input', async () => {
    const user = userEvent.setup()
    const { backend } = await openSignIn()
    const email = screen.getByLabelText('Email')

    await user.type(email, 'jo@example')
    await user.click(screen.getByRole('button', { name: 'Send code' }))

    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent("That doesn't look like an email address.")
    expect(email).toHaveAttribute('aria-invalid', 'true')
    expect(email).toHaveAttribute('aria-describedby', alert.id)
    expect(email).toHaveFocus()
    expect(backend.sendEmailCode).not.toHaveBeenCalled()

    await user.type(email, '.com')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('offline shows "You\'re offline. Connect to sign in."', async () => {
    const user = userEvent.setup()
    const { backend } = await openSignIn()
    setOnline(false)
    await user.type(screen.getByLabelText('Email'), 'jo@example.com')
    await user.click(screen.getByRole('button', { name: 'Send code' }))
    expect(screen.getByRole('alert')).toHaveTextContent("You're offline. Connect to sign in.")
    expect(backend.sendEmailCode).not.toHaveBeenCalled()
  })

  it('a failed send shows "Couldn\'t send the email. Try again." and keeps the email', async () => {
    const user = userEvent.setup()
    const backend = createFakeBackend(null)
    backend.sendEmailCode = vi.fn(async () => {
      throw new AuthError('unknown')
    })
    const { router } = await openSignIn('/signin', backend)
    await user.type(screen.getByLabelText('Email'), 'jo@example.com')
    await user.click(screen.getByRole('button', { name: 'Send code' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      "Couldn't send the email. Try again.",
    )
    expect(screen.getByLabelText('Email')).toHaveValue('jo@example.com')
    expect(router.state.location.pathname).toBe('/signin')
  })

  it('a network failure during send reads as offline', async () => {
    const user = userEvent.setup()
    const backend = createFakeBackend(null)
    backend.sendEmailCode = vi.fn(async () => {
      throw new AuthError('network')
    })
    await openSignIn('/signin', backend)
    await user.type(screen.getByLabelText('Email'), 'jo@example.com')
    await user.click(screen.getByRole('button', { name: 'Send code' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      "You're offline. Connect to sign in.",
    )
  })
})

describe('SignInScreen: email link', () => {
  it('verifies the token hash once under StrictMode and routes to the link next', async () => {
    const backend = createFakeBackend(null)
    const router = createMemoryRouter(routes, {
      initialEntries: ['/signin?next=%2Fboard&token_hash=hash-strict&type=email'],
    })
    render(<StrictMode>{withBackend(backend, <RouterProvider router={router} />)}</StrictMode>)

    await vi.waitFor(() => expect(router.state.location.pathname).toBe('/board'))
    expect(backend.verifyEmailLink).toHaveBeenCalledTimes(1)
    expect(backend.verifyEmailLink).toHaveBeenCalledWith('hash-strict')
    expect(sessionStorage.getItem(NEXT_KEY)).toBeNull()
  })

  it('falls back to the stored next, else /today', async () => {
    sessionStorage.setItem(NEXT_KEY, '/feed')
    const { router } = renderRoutes(
      ['/signin?token_hash=hash-stored&type=email'],
      createFakeBackend(null),
    )
    await vi.waitFor(() => expect(router.state.location.pathname).toBe('/feed'))

    const second = renderRoutes(
      ['/signin?token_hash=hash-none&type=email'],
      createFakeBackend(null),
    )
    await vi.waitFor(() => expect(second.router.state.location.pathname).toBe('/today'))
  })

  it('drops an unsafe next from the link', async () => {
    const { router } = renderRoutes(
      ['/signin?next=%2F%2Fevil.example&token_hash=hash-evil&type=email'],
      createFakeBackend(null),
    )
    await vi.waitFor(() => expect(router.state.location.pathname).toBe('/today'))
  })

  function rejectingLinkBackend() {
    const backend = createFakeBackend(null)
    backend.verifyEmailLink = vi.fn(async () => {
      throw new AuthError('link_rejected')
    })
    return backend
  }

  it('a used or expired link in a fresh tab (no stored email): "That code expired." and the empty email field focused', async () => {
    const { router } = renderRoutes(
      ['/signin?token_hash=hash-used&type=email'],
      rejectingLinkBackend(),
    )

    expect(await screen.findByRole('alert')).toHaveTextContent('That code expired.')
    expect(screen.queryByRole('button', { name: 'Send a new one' })).not.toBeInTheDocument()
    await vi.waitFor(() => expect(screen.getByLabelText('Email')).toHaveFocus())
    expect(screen.getByLabelText('Email')).toHaveValue('')
    expect(router.state.location.pathname).toBe('/signin')
    expect(router.state.location.search).toBe('')
  })

  it('a used or expired link with a stored email: "Send a new one" sends to it', async () => {
    const user = userEvent.setup()
    sessionStorage.setItem(SIGNIN_KEY, JSON.stringify({ email: 'jo@example.com', sentAt: 1 }))
    const backend = rejectingLinkBackend()
    const { router } = renderRoutes(['/signin?token_hash=hash-used-stored&type=email'], backend)

    expect(await screen.findByRole('alert')).toHaveTextContent('That code expired.')
    await user.click(screen.getByRole('button', { name: 'Send a new one' }))
    expect(backend.sendEmailCode).toHaveBeenCalledWith(
      'jo@example.com',
      `${window.location.origin}/signin?next=%2Ftoday`,
    )
    await vi.waitFor(() => expect(router.state.location.pathname).toBe('/signin/code'))
  })
})

describe('SignInScreen: Google', () => {
  it('starts OAuth with redirectTo {origin}/signin carrying the pending next', async () => {
    const user = userEvent.setup()
    sessionStorage.setItem(NEXT_KEY, '/join/AB12CD?x=1')
    const { backend } = await openSignIn()
    await user.click(screen.getByRole('button', { name: 'Continue with Google' }))
    expect(backend.signInWithGoogle).toHaveBeenCalledWith(
      `${window.location.origin}/signin?next=%2Fjoin%2FAB12CD%3Fx%3D1`,
    )
  })

  it('coming back without finishing makes Google tappable again', async () => {
    const user = userEvent.setup()
    const { backend } = await openSignIn()
    const button = screen.getByRole('button', { name: 'Continue with Google' })
    await user.click(button)
    await user.click(button)
    // Busy: the second tap is ignored while the browser leaves for Google.
    expect(backend.signInWithGoogle).toHaveBeenCalledTimes(1)

    // Back from Google (page restored from the back-forward cache).
    const restored = new Event('pageshow') as PageTransitionEvent
    Object.defineProperty(restored, 'persisted', { value: true })
    act(() => {
      window.dispatchEvent(restored)
    })
    await user.click(button)
    expect(backend.signInWithGoogle).toHaveBeenCalledTimes(2)

    // Back by closing Google's sheet in the installed app: the page becomes visible again.
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    await user.click(button)
    expect(backend.signInWithGoogle).toHaveBeenCalledTimes(3)
  })

  it('on return, exchanges the code once and lands on next', async () => {
    const backend = createFakeBackend(null)
    const { router } = renderRoutes(['/signin?next=%2Fme&code=oauth-1'], backend)
    await vi.waitFor(() => expect(router.state.location.pathname).toBe('/me'))
    expect(backend.exchangeOAuthCode).toHaveBeenCalledWith('oauth-1')
  })

  it('an OAuth error param shows "Couldn\'t sign in with Google. Try again."', async () => {
    const backend = createFakeBackend(null)
    renderRoutes(['/signin?error=access_denied&error_description=denied'], backend)
    expect(await screen.findByRole('alert')).toHaveTextContent(
      "Couldn't sign in with Google. Try again.",
    )
    expect(backend.exchangeOAuthCode).not.toHaveBeenCalled()
  })
})
