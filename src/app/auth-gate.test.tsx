import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NEXT_KEY, SIGNIN_KEY } from '@/data/pending-signin'
import { createFakeBackend, renderRoutes } from '@/test/fake-backend'
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
