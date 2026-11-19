import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BackendError } from '@/domain/error-codes'
import { createFakeBackend, renderRoutes, TEST_GROUP } from '@/test/fake-backend'

describe('Today states', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 10, 20, 12, 0, 0))
  })
  afterEach(() => vi.useRealTimers())

  it('an active group: the day-name heading and the Add button, no waiting state', async () => {
    renderRoutes(['/today'])
    expect(await screen.findByRole('heading', { level: 1, name: 'Friday' })).toBeInTheDocument()
    expect(screen.queryByText('Just you in here so far.')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add a commitment or task' })).toHaveTextContent(
      'Add',
    )
  })

  it('a waiting group: the waiting Empty state under the heading', async () => {
    renderRoutes(
      ['/today'],
      createFakeBackend(undefined, { groups: [{ ...TEST_GROUP, memberCount: 1 }] }),
    )
    expect(await screen.findByRole('heading', { level: 1, name: 'Friday' })).toBeInTheDocument()
    expect(screen.getByText('Just you in here so far.')).toBeInTheDocument()
    // Plans work in a waiting group too (FR-4): the Add button sits under the waiting state.
    expect(screen.getByRole('button', { name: 'Add a commitment or task' })).toBeInTheDocument()
  })

  it('a failed load: the Empty state with Try again, which refetches', async () => {
    const user = userEvent.setup()
    const backend = createFakeBackend()
    vi.mocked(backend.listMyGroups).mockRejectedValue(new BackendError('network'))
    renderRoutes(['/today'], backend)
    expect(
      await screen.findByText("Can't reach Proofy right now.", {}, { timeout: 3000 }),
    ).toBeInTheDocument()
    expect(screen.getByText('Check your signal and try again.')).toBeInTheDocument()

    vi.mocked(backend.listMyGroups).mockResolvedValue({ groups: [TEST_GROUP], ended: [] })
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(
      await screen.findByRole('button', { name: 'Group: Gym Rats, switch group' }),
    ).toBeInTheDocument()
    expect(screen.queryByText("Can't reach Proofy right now.")).not.toBeInTheDocument()
  })
})
