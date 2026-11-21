import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { BackendError } from '@/domain/error-codes'
import {
  boardRow,
  createFakeBackend,
  renderRoutes,
  TEST_GROUP,
  TEST_USER,
  testBadges,
  testBoard,
  testMemberProfile,
} from '@/test/fake-backend'
import { feedCheckin } from '@/test/feed-items'
import { waitForGroupInUrl } from '@/test/router'

const G = TEST_GROUP.id

const ME = testMemberProfile({
  displayName: 'Jo',
  allTimePoints: 1284,
  titleKey: 'regular',
  badges: testBadges({
    first_proof: { status: 'earned', awardedAt: '2026-11-12T00:00:01Z' },
    clean_sheet: { status: 'pending', pendingLockAt: '2026-11-25T16:00:00.000Z' },
  }),
  streaks: [
    { commitmentId: 'c1', activityName: 'Gym', currentStreak: 6, backToZero: false },
    { commitmentId: 'c2', activityName: 'Study', currentStreak: 0, backToZero: true },
  ],
})

const MARCO = testMemberProfile({
  displayName: 'Marco',
  allTimePoints: 300,
  titleKey: 'warming_up',
  badges: testBadges({ hat_trick: { status: 'earned', awardedAt: '2026-11-19T00:00:01Z' } }),
  plan: [{ activityName: 'Gym', scheduleType: 'times_per_week', days: null, target: 5 }],
  taskCount: 1,
  streaks: [{ commitmentId: 'c9', activityName: 'Gym', currentStreak: 3, backToZero: false }],
})

const marcoRow = boardRow({ userId: 'user-marco', displayName: 'Marco', weeklyPoints: 88, rank: 1 })
const joRow = boardRow({ userId: TEST_USER.id, displayName: 'Jo', weeklyPoints: 81, rank: 2 })

describe('Me profile (Story 4.6)', () => {
  it('shows the Title sticky, all-time points with separators, 15 seals with their statuses and the streaks', async () => {
    renderRoutes(
      [`/me?g=${G}`],
      createFakeBackend(undefined, { memberProfiles: { [`${G}:${TEST_USER.id}`]: ME } }),
    )
    expect(await screen.findByText('1,284 all-time points in Gym Rats')).toBeInTheDocument()
    expect(
      await screen.findByRole('button', { name: 'Title: Regular. Show all titles' }),
    ).toHaveTextContent('Regular')
    const grid = screen.getByRole('region', { name: 'Badges' })
    const seals = within(grid).getAllByRole('button')
    expect(seals).toHaveLength(15)
    expect(seals[0]).toHaveAccessibleName('First Proof, earned 12 Nov')
    expect(seals[4]).toHaveAccessibleName('Clean Sheet, pending')
    expect(seals[1]).toHaveAccessibleName('Hat Trick, locked')
    expect(within(seals[4]!).getByText('Unlocks at week lock')).toBeInTheDocument()
    expect(seals[0]!.querySelector('[data-status="earned"]')).not.toBeNull()
    expect(seals[1]!.querySelector('[data-status="locked"]')).not.toBeNull()
    const streaks = screen.getByRole('region', { name: 'Streaks' })
    expect(within(streaks).getByRole('img', { name: 'Gym streak 6' })).toBeInTheDocument()
    expect(within(streaks).getByRole('img', { name: 'Study back to 0' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Settings' })).toBeInTheDocument()
  })

  it('a seal opens its Sheet: earned with the line and date, pending with the lock time, locked with how to earn', async () => {
    const user = userEvent.setup()
    renderRoutes(
      [`/me?g=${G}`],
      createFakeBackend(undefined, { memberProfiles: { [`${G}:${TEST_USER.id}`]: ME } }),
    )
    await user.click(await screen.findByRole('button', { name: 'First Proof, earned 12 Nov' }))
    let sheet = await screen.findByRole('dialog', { name: 'First Proof' })
    expect(within(sheet).getByText('How First Proof is earned')).toBeInTheDocument()
    expect(within(sheet).getByText('First Proof line')).toHaveClass('type-hand-md')
    expect(within(sheet).getByText('Earned 12 Nov')).toBeInTheDocument()
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: 'Clean Sheet, pending' }))
    sheet = await screen.findByRole('dialog', { name: 'Clean Sheet' })
    // The test group is in Manila like the member: no zone named.
    expect(within(sheet).getByText('Unlocks when the week locks, Wed 23:59.')).toBeInTheDocument()
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: 'Task Slayer, locked' }))
    sheet = await screen.findByRole('dialog', { name: 'Task Slayer' })
    expect(within(sheet).getByText('How Task Slayer is earned')).toBeInTheDocument()
    expect(within(sheet).queryByText('Task Slayer line')).not.toBeInTheDocument()
  })

  it('a repeat badge earned 2+ times: "×3" on the seal, the count in its name and Sheet; once keeps the plain date (Epic 4 retro)', async () => {
    const user = userEvent.setup()
    const profile = testMemberProfile({
      badges: testBadges({
        first_proof: { status: 'earned', awardedAt: '2026-11-12T00:00:01Z', awardCount: 1 },
        weekly_winner: { status: 'earned', awardedAt: '2026-11-19T00:00:01Z', awardCount: 1 },
        team_player: { status: 'earned', awardedAt: '2026-11-12T00:00:01Z', awardCount: 3 },
      }),
    })
    renderRoutes(
      [`/me?g=${G}`],
      createFakeBackend(undefined, { memberProfiles: { [`${G}:${TEST_USER.id}`]: profile } }),
    )
    const teamPlayer = await screen.findByRole('button', {
      name: 'Team Player, earned 3 times, last 12 Nov',
    })
    expect(teamPlayer.querySelector('[data-badge-count]')).toHaveTextContent('×3')
    const winner = screen.getByRole('button', { name: 'Weekly Winner, earned 19 Nov' })
    expect(winner.querySelector('[data-badge-count]')).toBeNull()
    await user.click(teamPlayer)
    const sheet = await screen.findByRole('dialog', { name: 'Team Player' })
    expect(within(sheet).getByText('Earned 3 times · last 12 Nov')).toBeInTheDocument()
  })

  it('the Title sticky opens the ladder with the current title marked by a check and text', async () => {
    const user = userEvent.setup()
    renderRoutes(
      [`/me?g=${G}`],
      createFakeBackend(undefined, { memberProfiles: { [`${G}:${TEST_USER.id}`]: ME } }),
    )
    await user.click(await screen.findByRole('button', { name: 'Title: Regular. Show all titles' }))
    const sheet = await screen.findByRole('dialog', { name: 'Titles' })
    const rungs = within(sheet).getAllByRole('listitem')
    expect(rungs.map((rung) => rung.textContent)).toEqual([
      'Couch Potato · 0 points',
      'Warming Up · 300 points',
      'Regular · 1,000 pointscurrent title',
      'Grinder · 2,500 points',
      'Machine · 5,000 points',
      'Legend · 10,000 points',
    ])
    expect(rungs[2]).toHaveAttribute('aria-current', 'true')
  })

  it('shows the skeleton while the profile has no data', async () => {
    const backend = createFakeBackend()
    backend.getMemberProfile = () => new Promise(() => {})
    renderRoutes([`/me?g=${G}`], backend)
    expect(await screen.findByRole('status')).toHaveTextContent('Loading')
  })
})

describe('Member profile (Story 4.6)', () => {
  it('a podium block opens the member profile; it shows plan, title, points, badges, streaks and recent check-ins; Back returns to the Board', async () => {
    const user = userEvent.setup()
    const { router } = renderRoutes(
      [`/board?g=${G}`],
      createFakeBackend(undefined, {
        board: { [G]: testBoard({ rows: [marcoRow, joRow] }) },
        memberProfiles: { [`${G}:user-marco`]: MARCO },
        feed: {
          [G]: [
            feedCheckin({ id: 'c-m1', authorId: 'user-marco', authorName: 'Marco' }),
            feedCheckin({ id: 'c-other', authorId: 'user-2' }),
          ],
        },
      }),
    )
    await waitForGroupInUrl(router, G)
    const link = await screen.findByRole('link', { name: /^Marco, rank 1, 88 weekly points/ })
    expect(link).toHaveAttribute('href', `/board/m/user-marco?g=${G}`)
    await user.click(link)

    expect(await screen.findByRole('heading', { level: 1, name: 'Marco' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/board/m/user-marco')
    expect(screen.getByText('300 all-time points in Gym Rats')).toBeInTheDocument()
    expect(screen.getByText('Gym 5x · 1 task')).toBeInTheDocument()
    expect(
      await screen.findByRole('button', { name: 'Title: Warming Up. Show all titles' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Hat Trick, earned 19 Nov' })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Gym streak 3' })).toBeInTheDocument()
    const recent = await screen.findByRole('region', { name: 'Recent check-ins' })
    const thumbs = within(recent).getAllByRole('button')
    expect(thumbs).toHaveLength(1)
    await user.click(thumbs[0]!)
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: 'Back' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/board'))
    expect(router.state.location.search).toBe(`?g=${G}`)
  })

  it('a leaderboard row links too, and the viewer’s own block opens Me', async () => {
    const dev = boardRow({ userId: 'user-dev', displayName: 'Dev', weeklyPoints: 50, rank: 4 })
    const ana = boardRow({ userId: 'user-ana', displayName: 'Ana', weeklyPoints: 60, rank: 3 })
    const user = userEvent.setup()
    const { router } = renderRoutes(
      [`/board?g=${G}`],
      createFakeBackend(undefined, {
        board: { [G]: testBoard({ rows: [marcoRow, joRow, ana, dev] }) },
      }),
    )
    await waitForGroupInUrl(router, G)
    expect(await screen.findByRole('link', { name: /^Dev, rank 4/ })).toHaveAttribute(
      'href',
      `/board/m/user-dev?g=${G}`,
    )
    await user.click(screen.getByRole('link', { name: /^Jo, rank 2/ }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/me'))
  })

  it("one's own profile route redirects to Me", async () => {
    const { router } = renderRoutes([`/board/m/${TEST_USER.id}?g=${G}`], createFakeBackend())
    await waitFor(() => expect(router.state.location.pathname).toBe('/me'))
    expect(router.state.location.search).toBe(`?g=${G}`)
  })

  it('a member who left: "Sam isn\'t in this group anymore." and Back to the Board', async () => {
    const user = userEvent.setup()
    const { router } = renderRoutes(
      [`/board/m/user-sam?g=${G}`],
      createFakeBackend(undefined, {
        memberProfiles: {
          [`${G}:user-sam`]: testMemberProfile({
            displayName: 'Sam',
            isCurrentMember: false,
            titleKey: null,
            badges: [],
          }),
        },
      }),
    )
    expect(
      await screen.findByRole('heading', { level: 1, name: "Sam isn't in this group anymore." }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Badges' })).not.toBeInTheDocument()
    await user.click(screen.getAllByRole('button', { name: 'Back' })[1]!)
    await waitFor(() => expect(router.state.location.pathname).toBe('/board'))
  })

  it('someone never in the group gets the generic line', async () => {
    renderRoutes([`/board/m/user-nobody?g=${G}`], createFakeBackend())
    expect(
      await screen.findByRole('heading', { name: "This member isn't in this group anymore." }),
    ).toBeInTheDocument()
  })

  it('a ?g= the viewer is not in is corrected to the focused group by the shell', async () => {
    const { router } = renderRoutes(['/board/m/user-marco?g=other-group'], createFakeBackend())
    await waitForGroupInUrl(router, G)
    expect(router.state.location.pathname).toBe('/board/m/user-marco')
  })

  it("a failed read shows the can't-reach state and Try again reads again", async () => {
    const user = userEvent.setup()
    const backend = createFakeBackend()
    backend.getMemberProfile = vi.fn(async () => {
      throw new BackendError('network')
    })
    renderRoutes([`/board/m/user-marco?g=${G}`], backend)
    const retry = await screen.findByRole('button', { name: 'Try again' }, { timeout: 3000 })
    const calls = vi.mocked(backend.getMemberProfile).mock.calls.length
    await user.click(retry)
    await waitFor(() =>
      expect(vi.mocked(backend.getMemberProfile).mock.calls.length).toBeGreaterThan(calls),
    )
  })
})

describe('Me profile failure (Story 4.6)', () => {
  it('a failed profile read leaves Me with the name, My groups and the links, no skeleton', async () => {
    const backend = createFakeBackend()
    backend.getMemberProfile = vi.fn(async () => {
      throw new BackendError('network')
    })
    renderRoutes([`/me?g=${G}`], backend)
    expect(await screen.findByRole('region', { name: 'My groups' })).toBeInTheDocument()
    await waitFor(() => expect(backend.getMemberProfile).toHaveBeenCalled())
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument(), {
      timeout: 3000,
    })
    expect(screen.queryByRole('region', { name: 'Badges' })).not.toBeInTheDocument()
    expect(screen.getByText('Jo')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Settings' })).toBeInTheDocument()
  })
})
