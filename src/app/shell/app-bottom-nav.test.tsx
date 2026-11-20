import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { AppShell } from '@/app/shell/app-shell'
import { TodayScreen } from '@/app/screens/today'
import { Sheet } from '@/ui/sheet'
import { useState } from 'react'
import { createFakeBackend, renderRoutes, TEST_GROUP, withBackend } from '@/test/fake-backend'
import { feedCheckin } from '@/test/feed-items'
import { waitForGroupInUrl } from '@/test/router'

/** Test-only Feed route with a sheet already open. */
function FeedWithSheet() {
  const [open, setOpen] = useState(true)
  return (
    <>
      <h1 tabIndex={-1}>Feed</h1>
      <Sheet open={open} onOpenChange={setOpen} title="Test sheet">
        <p>inside</p>
      </Sheet>
    </>
  )
}

/** The app routes, signed in (the auth gate lets the shell through). */
function renderAt(path: string) {
  return renderRoutes([path]).router
}

function tab(name: string) {
  return screen.getByRole('link', { name })
}

describe('bottom nav', () => {
  it('shows Today, Feed, the Check in button, Board and Me, with aria-current on the active tab', async () => {
    renderAt('/today')
    await screen.findByRole('heading', { level: 1 })
    expect(screen.getByRole('navigation', { name: 'Main' })).toBeInTheDocument()
    expect(tab('Today')).toHaveAttribute('aria-current', 'page')
    for (const name of ['Feed', 'Board', 'Me']) {
      expect(tab(name)).not.toHaveAttribute('aria-current')
    }
    expect(screen.getByRole('button', { name: 'Check in' })).toBeInTheDocument()
  })

  it('pushes from Today, replaces between tabs, and pops back to Today without stacking', async () => {
    const user = userEvent.setup()
    const router = renderAt('/today')
    await screen.findByRole('heading', { level: 1 })
    // Today writes the focused group into the URL (a replace); let that settle before the push.
    await waitForGroupInUrl(router)

    await user.click(tab('Feed'))
    expect(router.state.location.pathname).toBe('/feed')
    expect(router.state.historyAction).toBe('PUSH')
    expect(tab('Feed')).toHaveAttribute('aria-current', 'page')
    expect(tab('Today')).not.toHaveAttribute('aria-current')

    await user.click(tab('Board'))
    expect(router.state.location.pathname).toBe('/board')
    expect(router.state.historyAction).toBe('REPLACE')

    await user.click(tab('Me'))
    expect(router.state.historyAction).toBe('REPLACE')

    await user.click(tab('Today'))
    // Going back to Today is a history pop, which settles asynchronously.
    await waitFor(() => expect(router.state.location.pathname).toBe('/today'))
    expect(router.state.historyAction).toBe('POP')
  })

  it('Today from a screen pushed from Me (My plan) goes back past Me to the Today entry', async () => {
    const user = userEvent.setup()
    const router = renderAt('/today')
    await screen.findByRole('heading', { level: 1 })
    await waitForGroupInUrl(router)

    await user.click(tab('Me'))
    await user.click(await screen.findByRole('link', { name: 'My plan' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/me/plan'))

    await user.click(tab('Today'))
    await waitFor(() => expect(router.state.location.pathname).toBe('/today'))
    expect(router.state.historyAction).toBe('POP')
    expect(router.state.location.search).toBe('?g=group-1')
  })

  it('Today after a tab switch on a screen pushed from Me still goes back to the Today entry', async () => {
    const user = userEvent.setup()
    const router = renderAt('/today')
    await screen.findByRole('heading', { level: 1 })
    await waitForGroupInUrl(router)

    await user.click(tab('Me'))
    await user.click(await screen.findByRole('link', { name: 'My plan' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/me/plan'))
    await user.click(tab('Feed'))
    expect(router.state.location.pathname).toBe('/feed')

    await user.click(tab('Today'))
    await waitFor(() => expect(router.state.location.pathname).toBe('/today'))
    expect(router.state.historyAction).toBe('POP')
  })

  it('the Me tab on a screen pushed from Me goes back to Me, so Today still lands on Today', async () => {
    const user = userEvent.setup()
    const router = renderAt('/today')
    await screen.findByRole('heading', { level: 1 })
    await waitForGroupInUrl(router)

    await user.click(tab('Me'))
    await user.click(await screen.findByRole('link', { name: 'My plan' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/me/plan'))
    await user.click(tab('Me'))
    await waitFor(() => expect(router.state.location.pathname).toBe('/me'))
    await user.click(await screen.findByRole('link', { name: 'My plan' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/me/plan'))

    await user.click(tab('Today'))
    await waitFor(() => expect(router.state.location.pathname).toBe('/today'))
  })

  it('the Me tab after a group change on a tab from a pushed screen lands on Me with the new group', async () => {
    const user = userEvent.setup()
    const backend = createFakeBackend(undefined, {
      groups: [TEST_GROUP, { ...TEST_GROUP, id: 'group-2', name: 'Night Owls' }],
    })
    const { router } = renderRoutes(['/today'], backend)
    await screen.findByRole('heading', { level: 1 })
    await waitForGroupInUrl(router, 'group-1')

    await user.click(tab('Me'))
    await user.click(await screen.findByRole('link', { name: 'My plan' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/me/plan'))
    await user.click(tab('Feed'))
    expect(router.state.location.pathname).toBe('/feed')
    // The group changes on the Feed tab (as the switcher does: a replace that keeps the state).
    await act(() =>
      router.navigate('/feed?g=group-2', { replace: true, state: router.state.location.state }),
    )

    await user.click(tab('Me'))
    await waitFor(() => expect(router.state.location.pathname).toBe('/me'))
    await waitForGroupInUrl(router, 'group-2')
  })

  it('system back on a non-Today tab lands on Today', async () => {
    const user = userEvent.setup()
    const router = renderAt('/today')
    await screen.findByRole('heading', { level: 1 })
    await user.click(tab('Feed'))
    await user.click(tab('Board'))

    await act(() => router.navigate(-1))
    expect(router.state.location.pathname).toBe('/today')
  })

  it('Esc on a non-Today tab goes to Today', async () => {
    const user = userEvent.setup()
    const router = renderAt('/today')
    await screen.findByRole('heading', { level: 1 })
    await user.click(tab('Me'))

    await user.keyboard('{Escape}')
    expect(router.state.location.pathname).toBe('/today')
  })

  it('rebuilds history as [Today, tab] on a cold start on another tab', async () => {
    const router = renderAt('/board')
    await screen.findByRole('heading', { level: 1, name: /^Leaderboard/ })
    // The rebuild pushes /board; the focus sync then replaces it with the group query.
    await waitForGroupInUrl(router, 'group-1')
    expect(router.state.location.pathname).toBe('/board')

    await act(() => router.navigate(-1))
    expect(router.state.location.pathname).toBe('/today')
  })

  it('rebuilds history as [Today, deep link] on a cold start on a check-in deep link', async () => {
    const id = '00000000-0000-4000-a000-000000000001'
    const backend = createFakeBackend(undefined, { feed: { 'group-1': [feedCheckin({ id })] } })
    const { router } = renderRoutes([`/feed/c/${id}?g=group-1`], backend)
    await screen.findByRole('heading', { level: 1, name: 'Feed · Gym Rats' })
    await vi.waitFor(() => expect(router.state.location.state).toMatchObject({ fromToday: true }))
    expect(router.state.location.pathname).toBe(`/feed/c/${id}`)
    expect(router.state.location.search).toBe('?g=group-1')

    await act(() => router.navigate(-1))
    expect(router.state.location.pathname).toBe('/today')
    expect(router.state.location.search).toBe('?g=group-1')
  })

  it('re-tapping the active tab scrolls to the top', async () => {
    const user = userEvent.setup()
    const router = renderAt('/today')
    await screen.findByRole('heading', { level: 1 })
    const scrollTo = vi.mocked(window.scrollTo)
    scrollTo.mockClear()

    await user.click(tab('Today'))
    expect(router.state.location.pathname).toBe('/today')
    expect(scrollTo).toHaveBeenCalledWith({ top: 0, left: 0 })
  })

  it('moves focus to the screen h1 on route change', async () => {
    const user = userEvent.setup()
    renderAt('/today')
    await screen.findByRole('heading', { level: 1 })
    await user.click(tab('Feed'))
    expect(screen.getByRole('heading', { level: 1, name: 'Feed · Gym Rats' })).toHaveFocus()
  })

  it('redirects / to /today, keeping the group query', async () => {
    const router = renderAt('/?g=group-1')
    await screen.findByRole('heading', { level: 1 })
    expect(router.state.location.pathname).toBe('/today')
    expect(router.state.location.search).toBe('?g=group-1')
  })

  it('carries ?g= across tab switches and in the tab links', async () => {
    const user = userEvent.setup()
    const router = renderAt('/today?g=group-1')
    await screen.findByRole('heading', { level: 1 })
    for (const name of ['Today', 'Feed', 'Board', 'Me']) {
      expect(tab(name).getAttribute('href')).toContain('?g=group-1')
    }

    for (const name of ['Feed', 'Board', 'Today']) {
      await user.click(tab(name))
      expect(router.state.location.search).toBe('?g=group-1')
    }
    expect(router.state.location.pathname).toBe('/today')
  })

  it('Esc with a sheet open on a tab closes the sheet and stays on the tab', async () => {
    const user = userEvent.setup()
    const router = createMemoryRouter(
      [
        {
          element: <AppShell />,
          children: [
            { path: 'today', element: <TodayScreen /> },
            { path: 'feed', element: <FeedWithSheet /> },
          ],
        },
      ],
      {
        initialEntries: [
          '/today',
          { pathname: '/feed', state: { fromToday: true, todaySearch: '' } },
        ],
        initialIndex: 1,
      },
    )
    render(withBackend(createFakeBackend(), <RouterProvider router={router} />))
    await screen.findByRole('dialog', { name: 'Test sheet' })

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/feed')
  })
})
