import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BackendError } from '@/domain/error-codes'
import { clearPostMoment, setPostMoment, type PostMoment } from '@/data/post-moment'
import {
  createFakeBackend,
  FAKE_PHOTO_ORIGIN,
  renderRoutes,
  TEST_GROUP,
  TEST_USER,
} from '@/test/fake-backend'
import { feedCheckin } from '@/test/feed-items'

// Friday 20 Nov 2026, 11:00 in Manila (the test profile's zone).
const NOW = new Date('2026-11-20T03:00:00Z')

const MARCO = feedCheckin({
  id: 'k-marco',
  sortAt: '2026-11-20T02:00:00.000000+00:00',
  authorId: 'user-5',
  authorName: 'Marco',
  capturedAt: '2026-11-20T01:59:00.000Z',
  receivedAt: '2026-11-20T02:00:00.000Z',
  caption: 'squat rack',
})
const MINE = feedCheckin({
  id: 'k-mine',
  sortAt: '2026-11-20T01:00:00.000000+00:00',
  authorId: TEST_USER.id,
  authorName: 'Jo',
  activityName: 'Paint',
  presetKey: 'paint',
  capturedAt: '2026-11-20T00:59:00.000Z',
  receivedAt: '2026-11-20T01:00:00.000Z',
  caption: null,
})
const LENA = feedCheckin({
  id: 'k-lena',
  sortAt: '2026-11-20T00:30:00.000000+00:00',
  authorId: 'user-6',
  authorName: 'Lena',
  activityName: 'Study',
  presetKey: 'study',
  taskName: 'Essay draft',
  commitmentKind: 'task',
  caption: null,
})

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
})

afterEach(() => {
  clearPostMoment()
  vi.useRealTimers()
})

function renderToday(options: Parameters<typeof createFakeBackend>[1] = {}) {
  const backend = createFakeBackend(undefined, options)
  renderRoutes(['/today'], backend)
  return backend
}

describe('Friends today', () => {
  it("shows the day's check-ins as tilted minis, newest first, then the See all card", async () => {
    const backend = renderToday({ friendsToday: { [TEST_GROUP.id]: [MARCO, MINE, LENA] } })

    const heading = await screen.findByRole('heading', {
      level: 2,
      name: 'Friends today · 3 posted',
    })
    const section = heading.closest('section') as HTMLElement
    const minis = within(section).getAllByRole('button')
    expect(minis.map((mini) => mini.getAttribute('aria-label'))).toEqual([
      "Marco's Gym check-in, 09:59, caption: squat rack",
      'Your Paint check-in, 08:59',
      "Lena's Essay draft check-in, 08:12",
    ])
    expect(minis.map((mini) => mini.textContent)).toEqual([
      'Marco · Gym',
      'You · Paint',
      'Lena · Essay draft',
    ])
    expect(minis[0]).toHaveClass('-rotate-3', 'w-[104px]')
    expect(minis[1]).toHaveClass('rotate-[2.5deg]')
    expect(minis[2]).toHaveClass('-rotate-[1.5deg]')
    expect(within(minis[1] as HTMLElement).getByText('You · Paint')).toHaveClass('type-hand-sm')

    // The 360 rendition only.
    await waitFor(() => expect(minis[0]?.querySelector('img')).not.toBeNull())
    const photo = minis[0]?.querySelector('img') as HTMLImageElement
    expect(photo.getAttribute('src')).toBe(
      `${FAKE_PHOTO_ORIGIN}/sign/${TEST_GROUP.id}/k-marco/360.webp?token=t`,
    )
    expect(photo).not.toHaveAttribute('srcset')

    const seeAll = within(section).getByRole('link', { name: 'See all in Feed' })
    expect(seeAll.getAttribute('href')).toMatch(/^\/feed(\?g=group-1)?$/)
    expect(backend.listFriendsToday).toHaveBeenCalledWith(TEST_GROUP.id)
  })

  it('opens the Photo viewer from a mini and returns focus to it', async () => {
    const user = userEvent.setup()
    renderToday({ friendsToday: { [TEST_GROUP.id]: [MARCO] } })
    const mini = await screen.findByRole('button', {
      name: "Marco's Gym check-in, 09:59, caption: squat rack",
    })
    await user.click(mini)
    const viewer = await screen.findByRole('dialog', { name: 'Marco · Gym · 09:59' })
    expect(within(viewer).getByText('squat rack')).toBeInTheDocument()
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(mini).toHaveFocus()
  })

  it('See all opens the Feed tab', async () => {
    const user = userEvent.setup()
    renderToday({ friendsToday: { [TEST_GROUP.id]: [MARCO] } })
    await user.click(await screen.findByRole('link', { name: 'See all in Feed' }))
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Feed · Gym Rats' }),
    ).toBeInTheDocument()
  })

  it('is hidden with no check-ins today, and when the list fails', async () => {
    const backend = renderToday()
    await waitFor(() => expect(backend.listFriendsToday).toHaveBeenCalled())
    expect(screen.queryByText('Friends today')).not.toBeInTheDocument()

    const failing = createFakeBackend()
    failing.listFriendsToday = vi.fn().mockRejectedValue(new BackendError('network'))
    renderRoutes(['/today'], failing)
    await waitFor(() => expect(failing.listFriendsToday).toHaveBeenCalled())
    expect(screen.queryByText('Friends today')).not.toBeInTheDocument()
  })

  it("leads with the member's just-posted check-in until the server list has it", async () => {
    const moment: PostMoment = {
      checkinId: 'k-new',
      groupId: TEST_GROUP.id,
      commitmentId: 'commitment-gym',
      title: 'Gym',
      doneCount: 1,
      target: 3,
      counted: true,
      isLate: false,
      weeklyPoints: null,
      rank: null,
      passedUserIds: [],
      passedShownIn: null,
      streakBefore: null,
      streakPopped: false,
      photoUrl: 'blob:local-photo',
      caption: 'first one',
      // After any fetch in this test, so the server list is older than the post.
      postedAt: Date.now() + 60_000,
      played: true,
      announced: true,
    }
    setPostMoment(moment)
    renderToday({ friendsToday: { [TEST_GROUP.id]: [MARCO] } })

    const heading = await screen.findByRole('heading', {
      level: 2,
      name: 'Friends today · 2 posted',
    })
    const section = heading.closest('section') as HTMLElement
    const [local, marco] = within(section).getAllByRole('button')
    expect(local).toHaveAttribute('data-component', 'post-moment')
    expect(local).toHaveAccessibleName('Your Gym check-in, caption: first one')
    expect(local).toHaveAttribute('aria-disabled', 'true')
    expect(local).toHaveTextContent('You · Gym')
    expect(local?.querySelector('img')).toHaveAttribute('src', 'blob:local-photo')
    expect(local).toHaveClass('-rotate-3')
    expect(marco).toHaveClass('rotate-[2.5deg]')
    // Not tappable: no viewer opens.
    await userEvent.setup().click(local as HTMLElement)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it("marks the server's mini once the list has the just-posted check-in", async () => {
    setPostMoment({
      checkinId: MINE.id,
      groupId: TEST_GROUP.id,
      commitmentId: 'commitment-gym',
      title: 'Gym',
      doneCount: 1,
      target: 3,
      counted: true,
      isLate: false,
      weeklyPoints: null,
      rank: null,
      passedUserIds: [],
      passedShownIn: null,
      streakBefore: null,
      streakPopped: false,
      photoUrl: null,
      caption: null,
      postedAt: Date.now() - 60_000,
      played: true,
      announced: true,
    })
    renderToday({ friendsToday: { [TEST_GROUP.id]: [MINE] } })
    const mini = await screen.findByRole('button', { name: 'Your Paint check-in, 08:59' })
    expect(mini).toHaveAttribute('data-component', 'post-moment')
    expect(
      screen.getByRole('heading', { level: 2, name: 'Friends today · 1 posted' }),
    ).toBeInTheDocument()
  })

  it("drops the local mini once a list fetched after the post doesn't have it", async () => {
    setPostMoment({
      checkinId: 'k-gone',
      groupId: TEST_GROUP.id,
      commitmentId: 'commitment-gym',
      title: 'Gym',
      doneCount: 1,
      target: 3,
      counted: true,
      isLate: false,
      weeklyPoints: null,
      rank: null,
      passedUserIds: [],
      passedShownIn: null,
      streakBefore: null,
      streakPopped: false,
      photoUrl: null,
      caption: null,
      // Before any fetch in this test: the server's list is newer and decides.
      postedAt: Date.now() - 60_000,
      played: true,
      announced: true,
    })
    renderToday({ friendsToday: { [TEST_GROUP.id]: [MARCO] } })
    // Before the list arrives the post shows locally; the list (fetched after the post) decides.
    const marco = await screen.findByRole('button', { name: /^Marco's Gym check-in/ })
    const section = marco.closest('section') as HTMLElement
    await waitFor(() => expect(section.querySelector('[data-mini="local"]')).toBeNull())
    expect(within(section).getAllByRole('button')).toHaveLength(1)
    expect(
      within(section).getByRole('heading', { level: 2, name: 'Friends today · 1 posted' }),
    ).toBeInTheDocument()
  })

  it('a mini whose photo cannot be signed keeps its gradient: no message, no nested Retry', async () => {
    const backend = createFakeBackend(undefined, {
      friendsToday: { [TEST_GROUP.id]: [MARCO] },
    })
    backend.signCheckinPhotos = vi.fn().mockRejectedValue(new BackendError('network'))
    renderRoutes(['/today'], backend)
    const mini = await screen.findByRole('button', { name: /^Marco's Gym check-in/ })
    // Signing fails, so the cached copy is tried; it is not there either (the load errors).
    const photo = await waitFor(() => {
      const img = mini.querySelector('img')
      expect(img).not.toBeNull()
      return img as HTMLImageElement
    })
    fireEvent.error(photo)
    await waitFor(() => expect(mini.querySelector('img')).toBeNull())
    expect(within(mini).queryByText("Photo didn't load.")).not.toBeInTheDocument()
    expect(within(mini).queryByText("Loads when you're back online.")).not.toBeInTheDocument()
    expect(mini.querySelector('button')).toBeNull()
  })
})
