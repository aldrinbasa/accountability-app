import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BackendError } from '@/domain/error-codes'
import type { FeedItem, FeedRuling } from '@/domain/feed'
import { createFakeBackend, renderRoutes, TEST_GROUP, TEST_USER } from '@/test/fake-backend'
import { feedCheckin } from '@/test/feed-items'
import { waitForGroupInUrl } from '@/test/router'

// Friday 20 Nov 2026, 11:00 in Manila (the test profile's zone); Priya posted at 08:12.
const NOW = new Date('2026-11-20T03:00:00Z')

const PRIYA = feedCheckin()
const MINE = feedCheckin({
  id: 'checkin-mine',
  sortAt: '2026-11-20T00:10:00.000000+00:00',
  authorId: TEST_USER.id,
  authorName: 'Jo',
  activityName: 'Paint',
  receivedAt: '2026-11-20T00:10:00.000Z',
})

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
})

afterEach(() => {
  vi.useRealTimers()
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => true })
})

function setOnline(online: boolean) {
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => online })
}

async function renderFeed(feed: FeedItem[], memberCount = 3) {
  const backend = createFakeBackend(undefined, {
    groups: [{ ...TEST_GROUP, memberCount }],
    feed: { [TEST_GROUP.id]: feed },
  })
  const result = renderRoutes(['/feed'], backend)
  await waitForGroupInUrl(result.router)
  return { ...result, backend }
}

const OVERFLOW = "More actions for Priya's Gym check-in"

async function openConfirm() {
  const user = userEvent.setup()
  const overflow = await screen.findByRole('button', { name: OVERFLOW })
  await user.click(overflow)
  const actions = await screen.findByRole('dialog', { name: "Priya's Gym check-in" })
  await user.click(within(actions).getByRole('button', { name: 'Challenge' }))
  const confirm = await screen.findByRole('dialog', { name: "Challenge Priya's Gym?" })
  return { user, overflow, confirm }
}

describe('Challenge a check-in (Story 5.1)', () => {
  it("offers the Overflow only on others' challengeable check-ins", async () => {
    await renderFeed([
      PRIYA,
      MINE,
      feedCheckin({ id: 'old', authorName: 'Sam', challengeUntil: '2026-11-20T02:59:59.000Z' }),
      feedCheckin({ id: 'taken', authorName: 'Lena', challengeId: 'ch', challengeStatus: 'real' }),
    ])
    expect(await screen.findByRole('button', { name: OVERFLOW })).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /^More actions for/ })).toHaveLength(1)
  })

  it('shows no Challenge in a waiting group', async () => {
    await renderFeed([PRIYA], 1)
    await screen.findByRole('heading', { level: 2, name: /^Priya · Gym/ })
    expect(screen.queryByRole('button', { name: OVERFLOW })).not.toBeInTheDocument()
  })

  it('3+ members: confirm, challenge, then the Vote chip replaces the Overflow', async () => {
    const { backend } = await renderFeed([PRIYA])
    const { user, confirm } = await openConfirm()
    expect(confirm).toHaveTextContent(
      "Your challenge counts as a Fake vote. The group has 24 h. If nobody else votes, it's ruled Fake; a tie keeps it.",
    )
    expect(confirm).toHaveTextContent("The photo's a ritual, not a court case.")
    await user.click(within(confirm).getByRole('button', { name: 'Challenge' }))

    expect(backend.createChallenge).toHaveBeenCalledWith(PRIYA.id)
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    // The fake opens it for 24 h from its clock; the wall's clock may run a moment later.
    const chip = await screen.findByText(/^CHALLENGED · 2[34] H LEFT$/)
    expect(chip.closest('[data-component="vote-chip"]')).toHaveTextContent(
      /challenged, 2[34] hours left/,
    )
    expect(screen.queryByRole('button', { name: OVERFLOW })).not.toBeInTheDocument()
    // Still counts provisionally: the polaroid stays.
    expect(screen.getByRole('heading', { level: 2, name: /^Priya · Gym/ })).toBeInTheDocument()
  })

  it('2 members: Rule it Fake removes the polaroid and adds the ruling sticky', async () => {
    await renderFeed([PRIYA], 2)
    const { user, confirm } = await openConfirm()
    expect(confirm).toHaveTextContent(
      "It's just the two of you, so this rules it Fake right away. No vote.",
    )
    expect(confirm).not.toHaveTextContent("The photo's a ritual")
    await user.click(within(confirm).getByRole('button', { name: 'Rule it Fake' }))

    const line = await screen.findByRole('heading', {
      level: 2,
      name: "Ruled Fake · You challenged · Priya's Gym removed.",
    })
    const sticky = line.closest('article') as HTMLElement
    expect(sticky).toHaveAttribute('data-kind', 'ruling')
    expect(sticky).toHaveTextContent('Ruling')
    expect(sticky.querySelector('[data-component="sticky-note"]')).toHaveClass('bg-vote')
    expect(screen.queryByRole('heading', { level: 2, name: /^Priya · Gym/ })).toBeNull()
    expect(screen.queryByText(/CHALLENGED/)).toBeNull()
    // The check-in left with the ruling: focus is on the Feed's h1, not lost to <body>.
    expect(screen.getByRole('heading', { level: 1, name: /^Feed/ })).toHaveFocus()
  })

  it('offline: Inline retry with the challenge copy; Retry sends the same request', async () => {
    const { backend } = await renderFeed([PRIYA])
    const { user, confirm } = await openConfirm()
    setOnline(false)
    await user.click(within(confirm).getByRole('button', { name: 'Challenge' }))
    expect(await within(confirm).findByRole('alert')).toHaveTextContent(
      "You're offline. Challenges need a signal.",
    )
    expect(backend.createChallenge).not.toHaveBeenCalled()
    setOnline(true)
    await user.click(within(confirm).getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(backend.createChallenge).toHaveBeenCalledWith(PRIYA.id))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('an online failure keeps the sheet open with Retry', async () => {
    const { backend } = await renderFeed([PRIYA])
    vi.mocked(backend.createChallenge).mockRejectedValueOnce(new BackendError('unknown'))
    const { user, confirm } = await openConfirm()
    await user.click(within(confirm).getByRole('button', { name: 'Challenge' }))
    expect(await within(confirm).findByRole('alert')).toHaveTextContent(
      "Couldn't send the challenge. Tap Retry.",
    )
    await user.click(within(confirm).getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(backend.createChallenge).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it.each(['already_challenged', 'challenge_expired', 'week_locked'] as const)(
    '%s: "can\'t be challenged anymore", no Retry, the Feed refetches',
    async (code) => {
      const { backend } = await renderFeed([PRIYA])
      vi.mocked(backend.createChallenge).mockRejectedValueOnce(new BackendError(code))
      const { user, confirm } = await openConfirm()
      const reads = vi.mocked(backend.listFeed).mock.calls.length
      await user.click(within(confirm).getByRole('button', { name: 'Challenge' }))
      expect(await within(confirm).findByRole('alert')).toHaveTextContent(
        "That check-in can't be challenged anymore.",
      )
      expect(within(confirm).queryByRole('button', { name: 'Retry' })).toBeNull()
      await waitFor(() =>
        expect(vi.mocked(backend.listFeed).mock.calls.length).toBeGreaterThan(reads),
      )
    },
  )

  it('closing either sheet returns focus to the Overflow', async () => {
    await renderFeed([PRIYA])
    const user = userEvent.setup()
    const overflow = await screen.findByRole('button', { name: OVERFLOW })
    await user.click(overflow)
    await screen.findByRole('dialog', { name: "Priya's Gym check-in" })
    await user.keyboard('{Escape}')
    await waitFor(() => expect(overflow).toHaveFocus())

    const { confirm } = await openConfirm()
    await user.click(within(confirm).getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await waitFor(() => expect(overflow).toHaveFocus())
  })

  it('renders ruling stickies with the "You" rule', async () => {
    const ruling: FeedRuling = {
      type: 'ruling',
      id: 'ruling-1',
      groupId: TEST_GROUP.id,
      sortAt: '2026-11-20T02:00:00.000000+00:00',
      challengeId: 'ch-1',
      checkinId: 'gone',
      challengerId: 'user-3',
      challengerName: 'Lena',
      ownerId: TEST_USER.id,
      ownerName: 'Jo',
      title: 'Study',
      outcome: 'real',
      fakeCount: 0,
      realCount: 1,
      variant: 'normal',
    }
    await renderFeed([ruling])
    expect(
      await screen.findByRole('heading', {
        level: 2,
        name: 'Ruled Real · Your Study stands. 0 Fake, 1 Real.',
      }),
    ).toBeInTheDocument()
  })
})

describe('Challenge from the Today friends strip', () => {
  it('puts the Overflow beside the mini and the Vote chip under the caption', async () => {
    const backend = createFakeBackend(undefined, {
      feed: { [TEST_GROUP.id]: [PRIYA] },
      friendsToday: {
        [TEST_GROUP.id]: [
          PRIYA,
          feedCheckin({
            id: 'checkin-sam',
            authorId: 'user-3',
            authorName: 'Sam',
            challengeId: 'ch-sam',
            challengeStatus: 'open',
            // 30 min 30 s after NOW: the strip's clock may run a little past NOW.
            challengeClosesAt: '2026-11-20T03:30:30.000Z',
          }),
        ],
      },
    })
    const result = renderRoutes(['/today'], backend)
    await waitForGroupInUrl(result.router)
    const overflow = await screen.findByRole('button', { name: OVERFLOW })
    const frame = overflow.closest('[data-challenge-host]') as HTMLElement
    expect(within(frame).getByRole('button', { name: /^Priya's Gym check-in/ })).toBeInTheDocument()
    expect(screen.getByText('CHALLENGED · 30 MIN LEFT')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /^More actions for/ })).toHaveLength(1)

    const user = userEvent.setup()
    await user.click(overflow)
    const actions = await screen.findByRole('dialog', { name: "Priya's Gym check-in" })
    await user.click(within(actions).getByRole('button', { name: 'Challenge' }))
    const confirm = await screen.findByRole('dialog', { name: "Challenge Priya's Gym?" })
    await user.click(within(confirm).getByRole('button', { name: 'Challenge' }))
    expect(backend.createChallenge).toHaveBeenCalledWith(PRIYA.id)
    expect(await screen.findByText(/^CHALLENGED · 2[34] H LEFT$/)).toBeInTheDocument()
  })
})
