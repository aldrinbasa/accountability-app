import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createFakeBackend, renderRoutes } from '@/test/fake-backend'

describe('join by code (create screen and sheet)', () => {
  it('the create screen has the approved copy and the join part under an "or"', async () => {
    renderRoutes(['/today'], createFakeBackend(undefined, { groups: [] }))
    await screen.findByRole('heading', { level: 1, name: 'Start a group' })
    expect(screen.getByText('Give it a name your friends will recognize.')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: 'Got an invite code?' })).toBeVisible()
    expect(screen.getByRole('textbox', { name: 'Invite code' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Join with a code' })).toBeInTheDocument()
  })

  it('an empty code is a Field error on the focused field and opens nothing', async () => {
    const user = userEvent.setup()
    const { router } = renderRoutes(['/today'], createFakeBackend(undefined, { groups: [] }))
    const field = await screen.findByRole('textbox', { name: 'Invite code' })
    await user.type(field, '   ')
    await user.click(screen.getByRole('button', { name: 'Join with a code' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Type the invite code.')
    expect(field).toHaveFocus()
    expect(field).toHaveAttribute('aria-invalid', 'true')
    expect(router.state.location.pathname).toBe('/today')
  })

  it('a typed code is trimmed and upper-cased and opens /join/{code}', async () => {
    const user = userEvent.setup()
    const { router } = renderRoutes(['/today'], createFakeBackend(undefined, { groups: [] }))
    await user.type(await screen.findByRole('textbox', { name: 'Invite code' }), ' k7qx2m ')
    await user.click(screen.getByRole('button', { name: 'Join with a code' }))
    await vi.waitFor(() => expect(router.state.location.pathname).toBe('/join/K7QX2M'))
    expect(router.state.historyAction).toBe('PUSH')
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Sunday Reset' }),
    ).toBeInTheDocument()
  })

  it('in the create sheet: a code closes the sheet and opens /join/{code} keeping ?g=', async () => {
    const user = userEvent.setup()
    const { router } = renderRoutes(['/board?g=group-1'])
    await user.click(await screen.findByRole('button', { name: /switch group/ }))
    const sheet = await screen.findByRole('dialog', { name: 'Your groups' })
    await user.click(within(sheet).getByRole('button', { name: 'Create or join a group' }))
    const form = await screen.findByRole('dialog', { name: 'Start a group' })
    await user.type(within(form).getByRole('textbox', { name: 'Invite code' }), 'k7qx2m')
    await user.click(within(form).getByRole('button', { name: 'Join with a code' }))

    await vi.waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await vi.waitFor(() => expect(router.state.location.pathname).toBe('/join/K7QX2M'))
    expect(router.state.location.search).toBe('?g=group-1')
  })

  it('a typed code in the create sheet asks "Discard this?" before closing', async () => {
    const user = userEvent.setup()
    renderRoutes(['/today?g=group-1'])
    await user.click(await screen.findByRole('button', { name: /switch group/ }))
    const sheet = await screen.findByRole('dialog', { name: 'Your groups' })
    await user.click(within(sheet).getByRole('button', { name: 'Create or join a group' }))
    await user.type(await screen.findByRole('textbox', { name: 'Invite code' }), 'K7')
    await user.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.getByText('Discard this?')).toBeInTheDocument()
  })
})
