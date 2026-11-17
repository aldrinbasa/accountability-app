import { act, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BackendError } from '@/domain/error-codes'
import { FOCUSED_GROUP_KEY } from '@/data/focused-group'
import { createFakeBackend, renderRoutes } from '@/test/fake-backend'

const OFFLINE = "You're offline. Groups need a signal to start."
const FAILED = "Couldn't create the group. Check your signal and tap Retry."

function setOnline(online: boolean) {
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => online })
}

afterEach(() => setOnline(true))

async function openCreateScreen(backend = createFakeBackend(undefined, { groups: [] })) {
  const result = renderRoutes(['/today'], backend)
  await screen.findByRole('heading', { level: 1, name: 'Start a group' })
  return result
}

function nameField() {
  return screen.getByRole('textbox', { name: 'Group name' })
}

describe('create a group (Today with no groups)', () => {
  it('shows the create screen with the approved copy, the nav and no switcher', async () => {
    await openCreateScreen()
    expect(
      screen.getByText('Give it a name your friends will recognize. Invites come next.'),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Create a group' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /switch group/ })).not.toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: 'Main' })).toBeInTheDocument()
  })

  it('an empty name shows the Field error, focuses the field and sends nothing', async () => {
    const user = userEvent.setup()
    const { backend } = await openCreateScreen()
    await user.type(nameField(), '   ')
    await user.click(screen.getByRole('button', { name: 'Create a group' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Give the group a name.')
    expect(nameField()).toHaveFocus()
    expect(nameField()).toHaveAttribute('aria-invalid', 'true')
    expect(backend.createGroup).not.toHaveBeenCalled()
  })

  it('reads "Saving…" while saving, then focuses the new group and opens Today on it', async () => {
    const user = userEvent.setup()
    const backend = createFakeBackend(undefined, { groups: [] })
    const real = backend.createGroup.bind(backend)
    let finish: () => void = () => {}
    vi.mocked(backend.createGroup).mockImplementationOnce(
      (name: string) =>
        new Promise<string>((resolve) => {
          finish = () => resolve(real(name))
        }),
    )
    const { router } = await openCreateScreen(backend)
    await user.type(nameField(), '  Sunday Reset ')
    await user.click(screen.getByRole('button', { name: 'Create a group' }))

    const busy = screen.getByRole('button', { name: 'Saving…' })
    expect(busy).toHaveAttribute('aria-busy', 'true')
    await user.click(busy)
    expect(backend.createGroup).toHaveBeenCalledTimes(1)
    expect(backend.createGroup).toHaveBeenCalledWith('Sunday Reset')

    await act(async () => finish())
    await screen.findByRole('button', { name: 'Group: Sunday Reset, switch group' })
    expect(router.state.location.pathname).toBe('/today')
    expect(router.state.location.search).toBe('?g=group-new-1')
    expect(localStorage.getItem(FOCUSED_GROUP_KEY)).toBe('group-new-1')
    // A 1-member group waits.
    expect(screen.getByText('Just you in here so far.')).toBeInTheDocument()
  })

  it('offline: Inline retry above the button, name kept; Retry sends once back online', async () => {
    const user = userEvent.setup()
    const { backend } = await openCreateScreen()
    await user.type(nameField(), 'Gym Rats')
    setOnline(false)
    await user.click(screen.getByRole('button', { name: 'Create a group' }))
    const retry = screen.getByRole('alert')
    expect(retry).toHaveTextContent(OFFLINE)
    expect(nameField()).toHaveValue('Gym Rats')
    expect(backend.createGroup).not.toHaveBeenCalled()
    const button = screen.getByRole('button', { name: 'Create a group' })
    expect(retry.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

    setOnline(true)
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    expect(backend.createGroup).toHaveBeenCalledWith('Gym Rats')
    await screen.findByRole('button', { name: 'Group: Gym Rats, switch group' })
  })

  it('a network error shows the offline copy; any other failure the generic copy', async () => {
    const user = userEvent.setup()
    const backend = createFakeBackend(undefined, { groups: [] })
    vi.mocked(backend.createGroup)
      .mockRejectedValueOnce(new BackendError('network'))
      .mockRejectedValueOnce(new BackendError('profile_required'))
    await openCreateScreen(backend)
    await user.type(nameField(), 'Gym Rats')
    await user.click(screen.getByRole('button', { name: 'Create a group' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(OFFLINE)

    await user.click(screen.getByRole('button', { name: 'Retry' }))
    await vi.waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(FAILED))
    expect(nameField()).toHaveValue('Gym Rats')
    expect(screen.getByRole('button', { name: 'Create a group' })).toBeInTheDocument()
  })

  it('a refetch that fails after the create still focuses the new group', async () => {
    const user = userEvent.setup()
    const backend = createFakeBackend(undefined, { groups: [] })
    const { router } = await openCreateScreen(backend)
    vi.mocked(backend.listMyGroups).mockRejectedValue(new BackendError('network'))
    await user.type(nameField(), ' Sunday Reset ')
    await user.click(screen.getByRole('button', { name: 'Create a group' }))

    expect(
      await screen.findByRole(
        'button',
        { name: 'Group: Sunday Reset, switch group' },
        { timeout: 3000 },
      ),
    ).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/today')
    expect(router.state.location.search).toBe('?g=group-new-1')
    expect(screen.queryByRole('button', { name: 'Saving…' })).not.toBeInTheDocument()
    expect(screen.getByText('Just you in here so far.')).toBeInTheDocument()
  })

  it('a server-side invalid_group_name is a Field error on the focused field, not an Inline retry', async () => {
    const user = userEvent.setup()
    const backend = createFakeBackend(undefined, { groups: [] })
    vi.mocked(backend.createGroup).mockRejectedValueOnce(new BackendError('invalid_group_name'))
    await openCreateScreen(backend)
    await user.type(nameField(), 'Gym Rats')
    await user.click(screen.getByRole('button', { name: 'Create a group' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Give the group a name.')
    expect(nameField()).toHaveFocus()
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument()
    expect(screen.queryByText(FAILED)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Create a group' })).toBeInTheDocument()
  })
})
