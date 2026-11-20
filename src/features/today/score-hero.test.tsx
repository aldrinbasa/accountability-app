import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Board } from '@/domain/board'
import { getLastSeenRank, setLastSeenRank } from '@/data/board'
import { getPostMoment, setPostMoment, type PostMoment } from '@/data/post-moment'
import { createFakeBackend, renderRoutes, TEST_GROUP, TEST_USER } from '@/test/fake-backend'
import { waitForGroupInUrl } from '@/test/router'

// Jo (the test user) is 2nd behind Priya; Sam has no score.
const BOARD: Board = {
  waiting: false,
  rows: [
    {
      userId: 'user-priya',
      displayName: 'Priya',
      avatarPath: null,
      weeklyPoints: 67,
      sessionsDone: 4,
      sessionsPlanned: 6,
      sessionsFrozen: 0,
      rank: 1,
    },
    {
      userId: TEST_USER.id,
      displayName: 'Jo',
      avatarPath: null,
      weeklyPoints: 63,
      sessionsDone: 5,
      sessionsPlanned: 8,
      sessionsFrozen: 0,
      rank: 2,
    },
    {
      userId: 'user-sam',
      displayName: 'Sam',
      avatarPath: null,
      weeklyPoints: null,
      sessionsDone: 0,
      sessionsPlanned: 0,
      sessionsFrozen: 0,
      rank: null,
    },
  ],
}

const MOMENT: PostMoment = {
  checkinId: 'k1',
  groupId: TEST_GROUP.id,
  commitmentId: 'c-gym',
  title: 'Gym',
  doneCount: 4,
  target: 5,
  counted: true,
  isLate: false,
  weeklyPoints: 70,
  rank: 1,
  passedUserIds: ['user-priya'],
  passedShownIn: null,
  photoUrl: null,
  caption: null,
  postedAt: 0,
  played: false,
  announced: false,
}

function sticker() {
  return screen.findByRole('link', {
    name: /weekly points\. Open the leaderboard$|^No score this week/,
  })
}

function chip() {
  return document.querySelector('[data-component="rank-chip"]')
}

describe('Today score (Story 4.1)', () => {
  it('shows the weekly points and the rank chip, and the sticker opens the Board', async () => {
    const backend = createFakeBackend(undefined, { board: { [TEST_GROUP.id]: BOARD } })
    const { router } = renderRoutes(['/today'], backend)
    const link = await sticker()
    expect(link).toHaveAccessibleName('63 weekly points. Open the leaderboard')
    expect(link).toHaveTextContent('63Weekly points')
    expect(chip()).toHaveTextContent("#2 · Priya's 4 ahead")
    // The week comes from the server (AD-11).
    expect(backend.getBoard).toHaveBeenCalledWith(TEST_GROUP.id, '2026-11-16')

    await waitForGroupInUrl(router, TEST_GROUP.id)
    expect(link).toHaveAttribute('href', `/board?g=${TEST_GROUP.id}`)
    await userEvent.click(link)
    await waitFor(() => expect(router.state.location.pathname).toBe('/board'))
    expect(router.state.location.search).toBe(`?g=${TEST_GROUP.id}`)
  })

  it('no score this week: the numeral is replaced and the chip hides', async () => {
    const rows = BOARD.rows.map((row) =>
      row.userId === TEST_USER.id ? { ...row, weeklyPoints: null, rank: null } : row,
    )
    const backend = createFakeBackend(undefined, {
      board: { [TEST_GROUP.id]: { waiting: false, rows } },
    })
    renderRoutes(['/today'], backend)
    const link = await sticker()
    expect(link).toHaveAccessibleName('No score this week. Open the leaderboard')
    expect(link).toHaveTextContent('no score this week')
    expect(chip()).toBeNull()
  })

  it('a waiting group shows neither the sticker nor the chip', async () => {
    const solo = { ...TEST_GROUP, memberCount: 1 }
    const backend = createFakeBackend(undefined, {
      groups: [solo],
      board: { [TEST_GROUP.id]: { waiting: true, rows: [{ ...BOARD.rows[1]!, rank: null }] } },
    })
    renderRoutes(['/today'], backend)
    expect(await screen.findByText('Just you in here so far.')).toBeInTheDocument()
    expect(screen.queryByText('Weekly points')).toBeNull()
    expect(chip()).toBeNull()
  })

  it('after a post: the returned points with the count bump, then "passed" until the next open', async () => {
    const backend = createFakeBackend(undefined, { board: { [TEST_GROUP.id]: BOARD } })
    const { router } = renderRoutes(['/today'], backend)
    await sticker()
    await waitForGroupInUrl(router, TEST_GROUP.id)

    // A post made now (after the board loaded): its values show until a later board fetch.
    act(() => setPostMoment({ ...MOMENT, postedAt: Date.now() + 1000 }))
    const link = await screen.findByRole('link', { name: '70 weekly points. Open the leaderboard' })
    expect(within(link).getByText('70')).toHaveClass('animate-count-bump')
    expect(chip()).toHaveTextContent('#1 · passed Priya')
    expect(chip()).toHaveClass('animate-chip-wobble')
    await waitFor(() => expect(getPostMoment()?.passedShownIn).not.toBeNull())

    // The next open of Today: the passed chip is gone; the board's values stand.
    await userEvent.click(screen.getByRole('link', { name: 'Feed' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/feed'))
    act(() => setPostMoment({ ...getPostMoment()!, postedAt: 0, played: true }))
    await userEvent.click(screen.getByRole('link', { name: 'Today' }))
    const again = await sticker()
    expect(again).toHaveAccessibleName('63 weekly points. Open the leaderboard')
    expect(chip()).toHaveTextContent("#2 · Priya's 4 ahead")
  })

  it('a rank worse than the one last seen on this device wobbles once and is remembered', async () => {
    setLastSeenRank(TEST_GROUP.id, 1)
    const backend = createFakeBackend(undefined, { board: { [TEST_GROUP.id]: BOARD } })
    renderRoutes(['/today'], backend)
    await sticker()
    await waitFor(() => expect(chip()).toHaveClass('animate-chip-wobble'))
    expect(getLastSeenRank(TEST_GROUP.id)).toBe(2)
  })

  it('a rank the device already saw does not wobble', async () => {
    setLastSeenRank(TEST_GROUP.id, 2)
    const backend = createFakeBackend(undefined, { board: { [TEST_GROUP.id]: BOARD } })
    renderRoutes(['/today'], backend)
    await sticker()
    expect(chip()).not.toHaveClass('animate-chip-wobble')
  })
  it('announces a rank change once, and not again for a refetch with the same rank', async () => {
    const backend = createFakeBackend(undefined, { board: { [TEST_GROUP.id]: BOARD } })
    const { queryClient } = renderRoutes(['/today'], backend)
    await sticker()
    const statuses = () => screen.getAllByRole('status').map((node) => node.textContent)
    expect(statuses()).not.toContain("#2 · Priya's 4 ahead")

    // Sam overtakes Jo: the refetched board has Jo 3rd.
    const dropped: Board = {
      waiting: false,
      rows: [
        BOARD.rows[0]!,
        { ...BOARD.rows[2]!, weeklyPoints: 65, sessionsDone: 3, rank: 2 },
        { ...BOARD.rows[1]!, rank: 3 },
      ],
    }
    vi.mocked(backend.getBoard).mockResolvedValue(dropped)
    await act(() => queryClient.invalidateQueries({ queryKey: ['board'] }))
    await waitFor(() => expect(chip()).toHaveTextContent("#3 · Sam's 2 ahead"))
    expect(statuses().filter((text) => text === "#3 · Sam's 2 ahead")).toHaveLength(1)

    await act(() => queryClient.invalidateQueries({ queryKey: ['board'] }))
    expect(statuses().filter((text) => text === "#3 · Sam's 2 ahead")).toHaveLength(1)
  })

  it("a rank change from the member's own post is left to the post announcement", async () => {
    const backend = createFakeBackend(undefined, { board: { [TEST_GROUP.id]: BOARD } })
    renderRoutes(['/today'], backend)
    await sticker()
    act(() => setPostMoment({ ...MOMENT, postedAt: Date.now() + 1000 }))
    await waitFor(() => expect(chip()).toHaveTextContent('#1 · passed Priya'))
    const statuses = screen.getAllByRole('status').map((node) => node.textContent)
    expect(statuses).toContain('Posted. Gym 4 of 5. 70 weekly points. Rank 1.')
    expect(statuses.some((text) => text?.startsWith('#1'))).toBe(false)
  })

  it('a late post leaves the score and chip to the board', async () => {
    const backend = createFakeBackend(undefined, { board: { [TEST_GROUP.id]: BOARD } })
    renderRoutes(['/today'], backend)
    await sticker()
    act(() => setPostMoment({ ...MOMENT, isLate: true, postedAt: Date.now() + 1000 }))
    const link = await sticker()
    expect(link).toHaveAccessibleName('63 weekly points. Open the leaderboard')
    // Nothing new to show, so no count bump.
    expect(within(link).getByText('63')).not.toHaveClass('animate-count-bump')
    expect(chip()).toHaveTextContent("#2 · Priya's 4 ahead")
    await waitFor(() =>
      expect(screen.getAllByRole('status').map((node) => node.textContent)).toContain(
        'Posted. Gym 4 of 5.',
      ),
    )
  })

  it('while the post values stand without a pass, the chip shows only the rank', async () => {
    const backend = createFakeBackend(undefined, { board: { [TEST_GROUP.id]: BOARD } })
    renderRoutes(['/today'], backend)
    await sticker()
    act(() =>
      setPostMoment({
        ...MOMENT,
        weeklyPoints: 65,
        rank: 2,
        passedUserIds: [],
        postedAt: Date.now() + 1000,
      }),
    )
    await screen.findByRole('link', { name: '65 weekly points. Open the leaderboard' })
    expect(chip()).toHaveTextContent(/^#2$/)
  })
})
