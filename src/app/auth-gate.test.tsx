import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { StrictMode } from 'react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { BackendError } from '@/domain/error-codes'
import { NEXT_KEY, SIGNIN_KEY } from '@/data/pending-signin'
import { routes } from '@/app/router'
import { createFakeBackend, renderRoutes, TEST_USER, withBackend } from '@/test/fake-backend'
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
    sessionStorage.setItem(NEXT_KEY, '/me?g=abc')
    sessionStorage.setItem(SIGNIN_KEY, JSON.stringify({ email: 'jo@example.com', sentAt: 1 }))
    const { router } = renderRoutes(['/signin'])
    await vi.waitFor(() => expect(router.state.location.pathname).toBe('/me'))
    expect(router.state.location.search).toBe('?g=abc')
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
    const { router } = renderRoutes(['/board?g=x'], newMember())
    expect(await screen.findByRole('heading', { level: 1, name: SETUP_HEADING })).toBeVisible()
    expect(router.state.location.pathname).toBe('/setup')
    expect(sessionStorage.getItem(NEXT_KEY)).toBe('/board?g=x')
    // Setup is a full-screen column: no shell nav.
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
  })

  it('no profile, signing in on /signin with a next: lands on /setup with next re-saved', async () => {
    sessionStorage.setItem(NEXT_KEY, '/me?g=abc')
    const { router } = renderRoutes(['/signin'], newMember())
    await screen.findByRole('heading', { level: 1, name: SETUP_HEADING })
    expect(router.state.location.pathname).toBe('/setup')
    expect(sessionStorage.getItem(NEXT_KEY)).toBe('/me?g=abc')
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
    sessionStorage.setItem(NEXT_KEY, '/feed?g=1')
    const router = createMemoryRouter(routes, { initialEntries: ['/setup'] })
    render(
      <StrictMode>
        {withBackend(createFakeBackend(), <RouterProvider router={router} />)}
      </StrictMode>,
    )
    await vi.waitFor(() => expect(router.state.location.pathname).toBe('/feed'))
    expect(router.state.location.search).toBe('?g=1')
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
