import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BackendError } from '@/domain/error-codes'
import type { MyGroup } from '@/domain/groups'
import { createFakeBackend, renderRoutes } from '@/test/fake-backend'

const GYM: MyGroup = {
  id: 'gym',
  name: 'Gym Rats',
  timeZone: 'Asia/Manila',
  role: 'admin',
  joinedAt: '2026-11-01T10:00:00Z',
  memberCount: 5,
}
const RESET: MyGroup = {
  id: 'reset',
  name: 'Sunday Reset',
  timeZone: 'Europe/Paris',
  role: 'member',
  joinedAt: '2026-11-03T10:00:00Z',
  memberCount: 1,
}

function renderAt(path: string) {
  return renderRoutes([path], createFakeBackend(undefined, { groups: [GYM, RESET] }))
}

describe('Me > My groups', () => {
  it('shows the display name, each group with its role chip and count, then Settings', async () => {
    renderAt('/me?g=gym')
    await screen.findByRole('heading', { level: 1, name: 'Me' })
    expect(await screen.findByText('Jo')).toBeInTheDocument()
    const section = await screen.findByRole('region', { name: 'My groups' })
    const rows = within(section).getAllByRole('link')
    expect(rows.map((row) => row.textContent)).toEqual([
      'Gym Rats5 of 10 membersAdmin',
      'Sunday Resetwaiting for a 2nd memberMember',
    ])
    expect(within(rows[0]).getByText('Admin')).toHaveClass('bg-vote')
    expect(within(rows[1]).getByText('Member')).toHaveClass('bg-card')
    expect(rows[0]).toHaveAttribute('href', '/me/groups/gym?g=gym')
    expect(screen.getByRole('link', { name: 'Settings' })).toBeInTheDocument()
  })

  it('a row opens group settings with the read-only time zone; Back returns to Me', async () => {
    const user = userEvent.setup()
    const { router } = renderAt('/me?g=gym')
    const section = await screen.findByRole('region', { name: 'My groups' })
    await user.click(within(section).getByRole('link', { name: /Sunday Reset/ }))

    expect(router.state.location.pathname).toBe('/me/groups/reset')
    expect(router.state.location.search).toBe('?g=gym')
    expect(screen.getByRole('heading', { level: 1, name: 'Sunday Reset' })).toBeInTheDocument()
    expect(screen.getByText('Group time zone')).toBeInTheDocument()
    expect(screen.getByText('Europe/Paris')).toBeInTheDocument()
    expect(
      screen.getByText('Sets the week lock and winner for everyone. Changes start next week.'),
    ).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Back' }))
    expect(router.state.location.pathname).toBe('/me')
    expect(router.state.historyAction).toBe('POP')
  })

  it('an unknown group id goes back to Me, keeping ?g=', async () => {
    const { router } = renderAt('/me/groups/nope?g=gym')
    await vi.waitFor(() => expect(router.state.location.pathname).toBe('/me'))
    expect(router.state.location.search).toBe('?g=gym')
    expect(router.state.historyAction).toBe('REPLACE')
  })

  it('cold-opened group settings: Back replaces to Me, keeping ?g=', async () => {
    const user = userEvent.setup()
    const { router } = renderAt('/me/groups/gym?g=gym')
    await screen.findByRole('heading', { level: 1, name: 'Gym Rats' })
    await user.click(screen.getByRole('button', { name: 'Back' }))
    expect(router.state.location.pathname).toBe('/me')
    expect(router.state.location.search).toBe('?g=gym')
    expect(router.state.historyAction).toBe('REPLACE')
  })

  it('group settings after a failed load: Back still shows, plus Try again, which refetches', async () => {
    const user = userEvent.setup()
    const backend = createFakeBackend(undefined, { groups: [GYM, RESET] })
    vi.mocked(backend.listMyGroups).mockRejectedValue(new BackendError('network'))
    renderRoutes(['/me/groups/gym?g=gym'], backend)
    expect(
      await screen.findByText("Can't reach Proofy right now.", {}, { timeout: 3000 }),
    ).toBeInTheDocument()
    expect(screen.getByText('Check your signal and try again.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Back' })).toBeInTheDocument()

    vi.mocked(backend.listMyGroups).mockResolvedValue({ groups: [GYM, RESET], ended: [] })
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Gym Rats' })).toBeInTheDocument()
  })

  it('Me after a failed groups load: an Inline retry that refetches', async () => {
    const user = userEvent.setup()
    const backend = createFakeBackend(undefined, { groups: [GYM, RESET] })
    vi.mocked(backend.listMyGroups).mockRejectedValue(new BackendError('network'))
    renderRoutes(['/me?g=gym'], backend)
    const retry = await screen.findByRole('alert', {}, { timeout: 3000 })
    expect(retry).toHaveTextContent("Couldn't load your groups. Check your signal and tap Retry.")

    vi.mocked(backend.listMyGroups).mockResolvedValue({ groups: [GYM, RESET], ended: [] })
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByRole('region', { name: 'My groups' })).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
