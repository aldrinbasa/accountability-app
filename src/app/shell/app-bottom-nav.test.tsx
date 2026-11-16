import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { AppShell } from '@/app/shell/app-shell'
import { TodayScreen } from '@/app/screens/today'
import { Sheet } from '@/ui/sheet'
import { useState } from 'react'
import { renderRoutes } from '@/test/fake-backend'

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
    expect(router.state.location.pathname).toBe('/today')
    expect(router.state.historyAction).toBe('POP')
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
    await screen.findByRole('heading', { level: 1, name: 'Board' })
    await vi.waitFor(() => expect(router.state.historyAction).toBe('PUSH'))
    expect(router.state.location.pathname).toBe('/board')

    await act(() => router.navigate(-1))
    expect(router.state.location.pathname).toBe('/today')
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
    expect(screen.getByRole('heading', { level: 1, name: 'Feed' })).toHaveFocus()
  })

  it('redirects / to /today, keeping the group query', async () => {
    const router = renderAt('/?g=abc')
    await screen.findByRole('heading', { level: 1 })
    expect(router.state.location.pathname).toBe('/today')
    expect(router.state.location.search).toBe('?g=abc')
  })

  it('carries ?g= across tab switches and in the tab links', async () => {
    const user = userEvent.setup()
    const router = renderAt('/today?g=abc')
    await screen.findByRole('heading', { level: 1 })
    for (const name of ['Today', 'Feed', 'Board', 'Me']) {
      expect(tab(name).getAttribute('href')).toContain('?g=abc')
    }

    for (const name of ['Feed', 'Board', 'Today']) {
      await user.click(tab(name))
      expect(router.state.location.search).toBe('?g=abc')
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
    render(<RouterProvider router={router} />)
    await screen.findByRole('dialog', { name: 'Test sheet' })

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/feed')
  })
})
