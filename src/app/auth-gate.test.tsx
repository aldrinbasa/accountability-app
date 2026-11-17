import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { StrictMode } from 'react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { BackendError } from '@/domain/error-codes'
import { NEXT_KEY, SIGNIN_KEY } from '@/data/pending-signin'
import { GUIDE_DISMISSED_KEY, INSTALLED_KEY, resetInstallState } from '@/data/install-state'
import { routes } from '@/app/router'
import { createFakeBackend, renderRoutes, TEST_USER, withBackend } from '@/test/fake-backend'
import { restoreDevice, setDevice, setStandalone, UA } from '@/test/install-env'
import { Toaster } from '@/ui/toaster'

describe('auth gate', () => {
  it('signed out: opens /signin and saves the asked-for path plus query as next', async () => {
    const { router } = renderRoutes(['/join/AB12CD?x=1'], createFakeBackend(null))
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Sign in to Proofy' }),
    ).toBeVisible()
    expect(router.state.location.pathname).toBe('/signin')
    expect(sessionStorage.getItem(NEXT_KEY)).toBe('/join/AB12CD?x=1')
  })

  it('shows blank paper (no screen, no nav) while the stored session is read', () => {
    const backend = createFakeBackend()
    backend.getSession = vi.fn(() => new Promise<never>(() => {}))
    renderRoutes(['/today'], backend)
    expect(screen.queryByRole('heading')).not.toBeInTheDocument()
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
  })

  it('signed in: opening /signin or /signin/code goes to /today', async () => {
    for (const path of ['/signin', '/signin/code']) {
      const { router, unmount } = renderRoutes([path])
      await vi.waitFor(() => expect(router.state.location.pathname).toBe('/today'))
      unmount()
    }
  })

  it('signed in on /signin with a pending next: goes there and clears it', async () => {
    sessionStorage.setItem(NEXT_KEY, '/me?g=group-1')
    sessionStorage.setItem(SIGNIN_KEY, JSON.stringify({ email: 'jo@example.com', sentAt: 1 }))
    const { router } = renderRoutes(['/signin'])
    await vi.waitFor(() => expect(router.state.location.pathname).toBe('/me'))
    expect(router.state.location.search).toBe('?g=group-1')
    expect(sessionStorage.getItem(NEXT_KEY)).toBeNull()
    expect(sessionStorage.getItem(SIGNIN_KEY)).toBeNull()
  })

  it('a session ended elsewhere sends the member to /signin without saving next', async () => {
    const backend = createFakeBackend()
    const onSignedOut = vi.fn()
    const { router } = renderRoutes(['/board'], backend, { onSignedOut })
    await screen.findByRole('heading', { level: 1, name: 'Board' })

    act(() => backend.emit(null))
    await vi.waitFor(() => expect(router.state.location.pathname).toBe('/signin'))
    expect(sessionStorage.getItem(NEXT_KEY)).toBeNull()
    expect(onSignedOut).toHaveBeenCalledTimes(1)
  })
})

describe('profile gate', () => {
  const SETUP_HEADING = 'What do your friends call you?'
  const newMember = () => createFakeBackend(TEST_USER, { profile: null })

  it('no profile: any route goes to /setup and keeps the path as next', async () => {
    const { router } = renderRoutes(['/board?g=group-1'], newMember())
    expect(await screen.findByRole('heading', { level: 1, name: SETUP_HEADING })).toBeVisible()
    expect(router.state.location.pathname).toBe('/setup')
    expect(sessionStorage.getItem(NEXT_KEY)).toBe('/board?g=group-1')
    // Setup is a full-screen column: no shell nav.
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
  })

  it('no profile, signing in on /signin with a next: lands on /setup with next re-saved', async () => {
    sessionStorage.setItem(NEXT_KEY, '/me?g=group-1')
    const { router } = renderRoutes(['/signin'], newMember())
    await screen.findByRole('heading', { level: 1, name: SETUP_HEADING })
    expect(router.state.location.pathname).toBe('/setup')
    expect(sessionStorage.getItem(NEXT_KEY)).toBe('/me?g=group-1')
  })

  it('no profile, opening /setup directly: stays, saves no next', async () => {
    const { router } = renderRoutes(['/setup'], newMember())
    await screen.findByRole('heading', { level: 1, name: SETUP_HEADING })
    expect(router.state.location.pathname).toBe('/setup')
    expect(sessionStorage.getItem(NEXT_KEY)).toBeNull()
  })

  it('has a profile: /setup goes to /today', async () => {
    const { router } = renderRoutes(['/setup'])
    await vi.waitFor(() => expect(router.state.location.pathname).toBe('/today'))
    expect(screen.queryByRole('heading', { name: SETUP_HEADING })).not.toBeInTheDocument()
  })

  it('has a profile under StrictMode: /setup forwards once to the pending next and clears it', async () => {
    sessionStorage.setItem(NEXT_KEY, '/feed?g=group-1')
    const router = createMemoryRouter(routes, { initialEntries: ['/setup'] })
    render(
      <StrictMode>
        {withBackend(createFakeBackend(), <RouterProvider router={router} />)}
      </StrictMode>,
    )
    await vi.waitFor(() => expect(router.state.location.pathname).toBe('/feed'))
    expect(router.state.location.search).toBe('?g=group-1')
    expect(sessionStorage.getItem(NEXT_KEY)).toBeNull()
  })

  it('shows blank paper while the profile loads', async () => {
    const backend = createFakeBackend()
    backend.getMyProfile = vi.fn(() => new Promise<never>(() => {}))
    renderRoutes(['/today'], backend)
    await vi.waitFor(() => expect(backend.getMyProfile).toHaveBeenCalled())
    expect(screen.queryByRole('heading')).not.toBeInTheDocument()
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
  })

  it('a failed profile read shows the app instead of a blank screen', async () => {
    const backend = createFakeBackend()
    backend.getMyProfile = vi.fn(async () => {
      throw new BackendError('network')
    })
    const { router } = renderRoutes(['/board'], backend)
    expect(await screen.findByRole('heading', { level: 1, name: 'Board' })).toBeVisible()
    expect(router.state.location.pathname).toBe('/board')
  })
})

describe('Settings', () => {
  it('Me links to Settings; back returns to Me', async () => {
    const user = userEvent.setup()
    const { router } = renderRoutes(
      ['/today', { pathname: '/me', state: { fromToday: true } }],
      undefined,
      {
        initialIndex: 1,
      },
    )
    await user.click(await screen.findByRole('link', { name: 'Settings' }))
    expect(router.state.location.pathname).toBe('/me/settings')
    expect(screen.getByRole('heading', { level: 1, name: 'Settings' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Back' }))
    await vi.waitFor(() => expect(router.state.location.pathname).toBe('/me'))
  })

  it('Sign out ends the session, clears the query cache and lands on /signin', async () => {
    const user = userEvent.setup()
    const backend = createFakeBackend()
    const onSignedOut = vi.fn()
    const { router } = renderRoutes(['/me/settings'], backend, { onSignedOut })

    await user.click(await screen.findByRole('button', { name: 'Sign out' }))
    expect(backend.signOut).toHaveBeenCalledTimes(1)
    await vi.waitFor(() => expect(router.state.location.pathname).toBe('/signin'))
    expect(onSignedOut).toHaveBeenCalledTimes(1)
    // Signing out never queues the settings screen as the place to come back to.
    expect(sessionStorage.getItem(NEXT_KEY)).toBeNull()
    expect(await screen.findByRole('heading', { name: 'Sign in to Proofy' })).toBeInTheDocument()
  })

  it('a failed sign-out shows the error toast, restores the row and stays on Settings', async () => {
    const user = userEvent.setup()
    const backend = createFakeBackend()
    backend.signOut = vi.fn(async () => {
      throw new Error('offline')
    })
    render(<Toaster />)
    const { router } = renderRoutes(['/me/settings'], backend)

    await user.click(await screen.findByRole('button', { name: 'Sign out' }))
    expect(await screen.findByText("Couldn't sign out. Try again.")).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/me/settings')
  })
})

describe('install guide right after sign-in', () => {
  const GUIDE_HEADING = 'Put Proofy on your home screen'
  const SETUP_HEADING = 'What do your friends call you?'

  afterEach(() => {
    resetInstallState()
    restoreDevice()
  })

  /** Opens /signin signed out, then completes a sign-in (as a verified code, link or Google would). */
  async function signIn(options: { profile?: null } = {}) {
    const backend = createFakeBackend(null, options)
    const result = renderRoutes(['/signin'], backend)
    await screen.findByRole('heading', { level: 1, name: 'Sign in to Proofy' })
    act(() => backend.emit(TEST_USER))
    return result
  }

  it('new member in a tab: /install first, then Continue goes to /setup and then to next', async () => {
    const user = userEvent.setup()
    setDevice(UA.iphoneSafari)
    sessionStorage.setItem(NEXT_KEY, '/board?g=group-1')
    sessionStorage.setItem(SIGNIN_KEY, JSON.stringify({ email: 'jo@example.com', sentAt: 1 }))
    const { router } = await signIn({ profile: null })

    expect(await screen.findByRole('heading', { level: 1, name: GUIDE_HEADING })).toBeVisible()
    expect(router.state.location.pathname).toBe('/install')
    // The guide keeps the pending next; the sign-in state is done with.
    expect(sessionStorage.getItem(NEXT_KEY)).toBe('/board?g=group-1')
    expect(sessionStorage.getItem(SIGNIN_KEY)).toBeNull()
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Continue without installing' }))
    await screen.findByRole('heading', { level: 1, name: SETUP_HEADING })
    expect(router.state.location.pathname).toBe('/setup')
    expect(sessionStorage.getItem(NEXT_KEY)).toBe('/board?g=group-1')

    await user.type(screen.getByLabelText('Display name'), 'Jo')
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await vi.waitFor(() => expect(router.state.location.pathname).toBe('/board'))
    expect(router.state.location.search).toBe('?g=group-1')
  })

  it('returning member: /install, then Continue goes to the pending next', async () => {
    const user = userEvent.setup()
    sessionStorage.setItem(NEXT_KEY, '/me?g=group-1')
    const { router } = await signIn()
    await screen.findByRole('heading', { level: 1, name: GUIDE_HEADING })
    await user.click(screen.getByRole('button', { name: 'Continue without installing' }))
    await vi.waitFor(() => expect(router.state.location.pathname).toBe('/me'))
    expect(sessionStorage.getItem(NEXT_KEY)).toBeNull()
  })

  it('installed (standalone or a stored appinstalled): sign-in goes straight on', async () => {
    sessionStorage.setItem(NEXT_KEY, '/feed')
    setStandalone(true)
    const first = await signIn()
    await vi.waitFor(() => expect(first.router.state.location.pathname).toBe('/feed'))
    first.unmount()

    setStandalone(false)
    localStorage.setItem(INSTALLED_KEY, '1')
    const second = await signIn()
    await vi.waitFor(() => expect(second.router.state.location.pathname).toBe('/today'))
  })

  it('dismissed earlier on this device: sign-in skips /install', async () => {
    localStorage.setItem(GUIDE_DISMISSED_KEY, '1')
    const { router } = await signIn({ profile: null })
    await screen.findByRole('heading', { level: 1, name: SETUP_HEADING })
    expect(router.state.location.pathname).toBe('/setup')
  })

  it('a pending next of /install: after the guide, /today', async () => {
    const user = userEvent.setup()
    sessionStorage.setItem(NEXT_KEY, '/install')
    const { router } = await signIn()
    await screen.findByRole('heading', { level: 1, name: GUIDE_HEADING })
    await user.click(screen.getByRole('button', { name: 'Continue without installing' }))
    await vi.waitFor(() => expect(router.state.location.pathname).toBe('/today'))
  })

  it('a pending next of /install with the guide dismissed: sign-in goes to /today', async () => {
    localStorage.setItem(GUIDE_DISMISSED_KEY, '1')
    sessionStorage.setItem(NEXT_KEY, '/install')
    const { router } = await signIn()
    await vi.waitFor(() => expect(router.state.location.pathname).toBe('/today'))
  })

  it('a new member on /install/ or /INSTALL sees the guide, not /setup', async () => {
    for (const path of ['/install/', '/INSTALL']) {
      const { router, unmount } = renderRoutes(
        [path],
        createFakeBackend(TEST_USER, { profile: null }),
      )
      await screen.findByRole('heading', { level: 1, name: GUIDE_HEADING })
      expect(router.state.location.pathname).toBe(path)
      unmount()
    }
  })

  it('a cold open of an already signed-in member never shows the guide', async () => {
    for (const path of ['/signin', '/today']) {
      const { router, unmount } = renderRoutes([path])
      await screen.findByRole('button', { name: 'Group: Gym Rats, switch group' })
      expect(router.state.location.pathname).toBe('/today')
      expect(screen.queryByRole('heading', { name: GUIDE_HEADING })).not.toBeInTheDocument()
      unmount()
    }
  })

  it('under StrictMode the sign-in goes to /install once and keeps next', async () => {
    sessionStorage.setItem(NEXT_KEY, '/board?g=group-1')
    const backend = createFakeBackend(null)
    const router = createMemoryRouter(routes, { initialEntries: ['/signin'] })
    render(<StrictMode>{withBackend(backend, <RouterProvider router={router} />)}</StrictMode>)
    await screen.findByRole('heading', { level: 1, name: 'Sign in to Proofy' })
    act(() => backend.emit(TEST_USER))
    await screen.findByRole('heading', { level: 1, name: GUIDE_HEADING })
    expect(router.state.location.pathname).toBe('/install')
    expect(sessionStorage.getItem(NEXT_KEY)).toBe('/board?g=group-1')
  })
})
