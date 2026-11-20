import { act, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { MyGroup } from '@/domain/groups'
import { FOCUSED_GROUP_KEY } from '@/data/focused-group'
import { createFakeBackend, renderRoutes } from '@/test/fake-backend'
import { waitForGroupInUrl } from '@/test/router'

const GYM: MyGroup = {
  id: 'gym',
  name: 'Gym Rats',
  timeZone: 'Asia/Manila',
  pendingTimeZone: null,
  pendingWeekStart: null,
  role: 'admin',
  joinedAt: '2026-11-01T10:00:00Z',
  memberCount: 5,
}
const RESET: MyGroup = {
  id: 'reset',
  name: 'Sunday Reset',
  timeZone: 'UTC',
  pendingTimeZone: null,
  pendingWeekStart: null,
  role: 'member',
  joinedAt: '2026-11-03T10:00:00Z',
  memberCount: 1,
}

function renderAt(path: string, groups: MyGroup[] = [GYM, RESET]) {
  return renderRoutes([path], createFakeBackend(undefined, { groups }))
}

/** Records, for each change of the router's search, whether the sheet's window.history entry was on top. */
function recordSheetEntryOnSearchChange(router: ReturnType<typeof renderAt>['router']) {
  const seen: boolean[] = []
  let search = router.state.location.search
  router.subscribe((state) => {
    if (state.location.search === search) return
    search = state.location.search
    seen.push(window.history.state?.sheet === true)
  })
  return seen
}

describe('group switcher', () => {
  it('names the focused group, is a 44px pill, and shows the filled dot for an active group', async () => {
    renderAt('/today?g=gym')
    const switcher = await screen.findByRole('button', { name: 'Group: Gym Rats, switch group' })
    expect(switcher).toHaveClass('min-h-target-min')
    expect(switcher.querySelector('[aria-hidden="true"]')).not.toHaveAttribute('data-waiting')
  })

  it('a waiting group: outlined dot and the waiting Empty state', async () => {
    renderAt('/today?g=reset')
    const switcher = await screen.findByRole('button', {
      name: 'Group: Sunday Reset, switch group',
    })
    expect(switcher.querySelector('[data-waiting]')).not.toBeNull()
    expect(screen.getByText('Just you in here so far.')).toBeInTheDocument()
    expect(
      screen.getByText(
        'Scoring, votes and the leaderboard start the moment a second friend joins. Accountability needs an audience.',
      ),
    ).toBeInTheDocument()
  })

  it('reports its sheet with aria-expanded', async () => {
    const user = userEvent.setup()
    renderAt('/today?g=gym')
    const switcher = await screen.findByRole('button', { name: /switch group/ })
    expect(switcher).toHaveAttribute('aria-expanded', 'false')
    await user.click(switcher)
    await screen.findByRole('dialog', { name: 'Your groups' })
    expect(switcher).toHaveAttribute('aria-expanded', 'true')
  })

  it('shows on a trailing-slash path too', async () => {
    renderAt('/today/?g=gym')
    expect(
      await screen.findByRole('button', { name: 'Group: Gym Rats, switch group' }),
    ).toBeInTheDocument()
  })

  it('shows on Today, Feed and Board only', async () => {
    const user = userEvent.setup()
    renderAt('/today?g=gym')
    await screen.findByRole('button', { name: /switch group/ })
    for (const tab of ['Feed', 'Board']) {
      await user.click(screen.getByRole('link', { name: tab }))
      expect(screen.getByRole('button', { name: /switch group/ })).toBeInTheDocument()
    }
    await user.click(screen.getByRole('link', { name: 'Me' }))
    expect(screen.queryByRole('button', { name: /switch group/ })).not.toBeInTheDocument()
  })

  it('"Your groups" lists role and count, checks the focused group, and ends with Create or join', async () => {
    const user = userEvent.setup()
    renderAt('/today?g=gym')
    await user.click(await screen.findByRole('button', { name: /switch group/ }))
    const sheet = await screen.findByRole('dialog', { name: 'Your groups' })
    const rows = within(sheet).getAllByRole('listitem')
    expect(rows.map((row) => row.textContent)).toEqual([
      'Gym RatsAdmin · 5 members',
      'Sunday ResetMember · waiting for a 2nd member',
      'Create or join a group',
    ])
    expect(within(sheet).getByRole('button', { name: /Gym Rats/ })).toHaveAttribute(
      'aria-current',
      'true',
    )
    expect(within(sheet).getByRole('button', { name: /Sunday Reset/ })).not.toHaveAttribute(
      'aria-current',
    )
  })

  it('picking a group refocuses by replacing ?g= and closes the sheet', async () => {
    const user = userEvent.setup()
    const { router } = renderAt('/feed?g=gym')
    await user.click(await screen.findByRole('button', { name: /switch group/ }))
    const sheet = await screen.findByRole('dialog', { name: 'Your groups' })
    const sheetOnTop = recordSheetEntryOnSearchChange(router)
    await user.click(within(sheet).getByRole('button', { name: /Sunday Reset/ }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await waitForGroupInUrl(router, 'reset')
    expect(router.state.historyAction).toBe('REPLACE')
    expect(router.state.location.pathname).toBe('/feed')
    // The navigation waited until the sheet's history entry was gone.
    expect(sheetOnTop).toEqual([false])
    expect(localStorage.getItem(FOCUSED_GROUP_KEY)).toBe('reset')
    expect(
      await screen.findByRole('button', { name: 'Group: Sunday Reset, switch group' }),
    ).toBeInTheDocument()
  })

  it('"Create or join a group" opens the create form in the sheet; creating opens Today on it', async () => {
    const user = userEvent.setup()
    const { router, backend } = renderAt('/board?g=gym')
    await user.click(await screen.findByRole('button', { name: /switch group/ }))
    const sheet = await screen.findByRole('dialog', { name: 'Your groups' })
    await user.click(within(sheet).getByRole('button', { name: 'Create or join a group' }))

    const form = await screen.findByRole('dialog', { name: 'Start a group' })
    const sheetOnTop = recordSheetEntryOnSearchChange(router)
    const field = within(form).getByRole('textbox', { name: 'Group name' })
    expect(field).toHaveFocus()
    await user.type(field, 'Book Club')
    await user.click(within(form).getByRole('button', { name: 'Create a group' }))

    expect(backend.createGroup).toHaveBeenCalledWith('Book Club')
    await vi.waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await vi.waitFor(() => expect(router.state.location.pathname).toBe('/today'))
    expect(router.state.location.search).toBe('?g=group-new-1')
    expect(sheetOnTop.length).toBeGreaterThan(0)
    expect(sheetOnTop).not.toContain(true)
    expect(
      await screen.findByRole('button', { name: 'Group: Book Club, switch group' }),
    ).toBeInTheDocument()
  })

  it('a typed name in the create sheet asks "Discard this?" before closing', async () => {
    const user = userEvent.setup()
    renderAt('/today?g=gym')
    await user.click(await screen.findByRole('button', { name: /switch group/ }))
    const sheet = await screen.findByRole('dialog', { name: 'Your groups' })
    await user.click(within(sheet).getByRole('button', { name: 'Create or join a group' }))
    await user.type(await screen.findByRole('textbox', { name: 'Group name' }), 'Draft')
    await user.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.getByText('Discard this?')).toBeInTheDocument()
  })

  it('after switching on Feed, Today pops back to the Today entry and shows the new group', async () => {
    const user = userEvent.setup()
    const { router } = renderAt('/today?g=gym')
    await screen.findByRole('button', { name: 'Group: Gym Rats, switch group' })
    await user.click(screen.getByRole('link', { name: 'Feed' }))
    expect(router.state.historyAction).toBe('PUSH')

    await user.click(screen.getByRole('button', { name: /switch group/ }))
    const sheet = await screen.findByRole('dialog', { name: 'Your groups' })
    await user.click(within(sheet).getByRole('button', { name: /Sunday Reset/ }))
    await waitForGroupInUrl(router, 'reset')
    // Wait for the re-render too: the nav's click handler reads the rendered location.
    await screen.findByRole('button', { name: 'Group: Sunday Reset, switch group' })

    await user.click(screen.getByRole('link', { name: 'Today' }))
    await vi.waitFor(() => expect(router.state.location.pathname).toBe('/today'))
    await waitForGroupInUrl(router, 'reset')
    expect(
      await screen.findByRole('button', { name: 'Group: Sunday Reset, switch group' }),
    ).toBeInTheDocument()

    // The Today entry itself now holds the new group: no entry with the old group is left behind.
    await act(() => router.navigate(-1))
    expect(router.state.location.pathname).toBe('/today')
    expect(router.state.location.search).toBe('?g=reset')
  })
})
