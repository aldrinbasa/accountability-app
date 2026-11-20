import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BackendError } from '@/domain/error-codes'
import type { FeedItem } from '@/domain/feed'
import { putOutboxEntry } from '@/data/outbox-db'
import { setStoredFocusedGroup } from '@/data/focused-group'
import { Toaster } from '@/ui/toaster'
import {
  createFakeBackend,
  FAKE_PHOTO_ORIGIN,
  renderRoutes,
  TEST_GROUP,
  TEST_USER,
} from '@/test/fake-backend'
import { feedCheckin, feedCheckinId, feedCheckins, feedEvent } from '@/test/feed-items'
import { intersectAll } from '@/test/intersection-observer'

// Friday 20 Nov 2026, 11:00 in Manila (the test profile's zone).
const NOW = new Date('2026-11-20T03:00:00Z')

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
})

afterEach(() => {
  vi.useRealTimers()
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => true })
})

function renderFeed(
  path: string,
  feed: FeedItem[],
  options: Parameters<typeof createFakeBackend>[1] = {},
) {
  const backend = createFakeBackend(undefined, { feed: { [TEST_GROUP.id]: feed }, ...options })
  return renderRoutes([path], backend)
}

function articles() {
  return screen.getAllByRole('article')
}

describe('Feed wall', () => {
  it('maps check-ins to polaroids and events to stickies, newest first', async () => {
    const late = feedCheckin({
      id: 'late',
      sortAt: '2026-11-20T01:00:00.000000+00:00',
      authorId: 'user-3',
      authorName: 'Sam',
      activityName: 'Paint',
      presetKey: 'paint',
      capturedAt: '2026-11-19T10:00:00.000Z',
      receivedAt: '2026-11-20T01:00:00.000Z',
      isLate: true,
      caption: 'the sky is fighting me',
      countedPosition: 1,
      target: 2,
    })
    const extra = feedCheckin({
      id: 'extra',
      sortAt: '2026-11-20T00:30:00.000000+00:00',
      authorId: TEST_USER.id,
      authorName: 'Jo',
      isExtra: true,
      countedPosition: null,
      target: null,
      caption: null,
      capturedAt: '2026-11-20T00:29:00.000Z',
    })
    const handover = feedEvent({
      id: 'handover',
      kind: 'admin_handover',
      sortAt: '2026-11-18T10:00:00.000000+00:00',
      actorId: 'user-9',
      actorName: 'Marco',
      subjectId: 'user-2',
      subjectName: 'Priya',
    })
    renderFeed('/feed', [handover, feedCheckin(), extra, feedEvent(), late])

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Feed · Gym Rats' }),
    ).toBeInTheDocument()
    await waitFor(() => expect(articles()).toHaveLength(5))
    expect(
      articles().map((article) => within(article).getByRole('heading', { level: 2 }).textContent),
    ).toEqual([
      'Sam · Paint · Thu 18:00',
      'You · Gym · 08:29',
      'Priya · Gym · 08:12',
      'Sam joined.',
      'Marco left. Priya is admin now.',
    ])

    const [lateArticle, extraArticle, onTime] = articles()
    expect(within(onTime as HTMLElement).getByText('leg day')).toBeInTheDocument()
    expect(onTime).toHaveTextContent('Priya · Gym · 2/3 · 08:12')
    expect(extraArticle).toHaveTextContent('You · Gym · extra · 08:29')
    expect(lateArticle).toHaveTextContent('Sam · Paint · 1/2 · Thu 18:00')
    expect(within(lateArticle as HTMLElement).getByText('sent 15 hours later')).toBeInTheDocument()
    expect(within(lateArticle as HTMLElement).getByText('sent 15 h later')).toHaveAttribute(
      'aria-hidden',
      'true',
    )

    // Photos: alt text, CORS, eager for the first two only.
    const photo = await within(onTime as HTMLElement).findByRole('img', {
      name: "Priya's Gym check-in, 08:12, caption: leg day",
    })
    expect(photo).toHaveAttribute('crossorigin', 'anonymous')
    expect(photo).toHaveAttribute('draggable', 'false')
    expect(photo).toHaveAttribute('loading', 'lazy')
    expect(
      await within(lateArticle as HTMLElement).findByRole('img', { name: /Sam's Paint check-in/ }),
    ).toHaveAttribute('loading', 'eager')
    expect(photo.getAttribute('src')).toBe(
      `${FAKE_PHOTO_ORIGIN}/sign/${TEST_GROUP.id}/checkin-1/360.webp?token=t`,
    )
    expect(photo.getAttribute('srcset')).toContain('1080.webp?token=t 1080w')
  })

  it('loads the next 20 by keyset when the end comes near', async () => {
    const backend = createFakeBackend(undefined, { feed: { [TEST_GROUP.id]: feedCheckins(25) } })
    renderRoutes(['/feed'], backend)
    await waitFor(() => expect(articles()).toHaveLength(20))
    act(() => intersectAll())
    await waitFor(() => expect(articles()).toHaveLength(25))
    expect(backend.listFeed).toHaveBeenLastCalledWith(TEST_GROUP.id, {
      before: expect.objectContaining({ itemId: feedCheckinId(20) }),
      limit: 20,
    })
  })

  it('stops auto-loading when an older page fails, and offers Retry', async () => {
    const user = userEvent.setup()
    const backend = createFakeBackend(undefined, { feed: { [TEST_GROUP.id]: feedCheckins(25) } })
    const list = backend.listFeed
    renderRoutes(['/feed'], backend)
    await waitFor(() => expect(articles()).toHaveLength(20))
    backend.listFeed = vi.fn(async () => {
      throw new BackendError('network')
    })
    act(() => intersectAll())
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent("Couldn't load older posts.")
    // No loop: the sentinel stays quiet while the failure shows (one query retry before it).
    const calls = vi.mocked(backend.listFeed).mock.calls.length
    act(() => intersectAll())
    expect(backend.listFeed).toHaveBeenCalledTimes(calls)

    backend.listFeed = list
    await user.click(within(alert).getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(articles()).toHaveLength(25))
    expect(screen.queryByText("Couldn't load older posts.")).not.toBeInTheDocument()
  })

  it('never fires a next page while the whole wall refetches', async () => {
    const backend = createFakeBackend(undefined, { feed: { [TEST_GROUP.id]: feedCheckins(25) } })
    const { queryClient } = renderRoutes(['/feed'], backend)
    await waitFor(() => expect(articles()).toHaveLength(20))
    let release: () => void = () => {}
    const list = backend.listFeed
    backend.listFeed = vi.fn(async (...args: Parameters<typeof list>) => {
      await new Promise<void>((resolve) => {
        release = resolve
      })
      return list(...args)
    })
    const refetch = act(() => queryClient.refetchQueries({ queryKey: ['feed'] }))
    await waitFor(() => expect(backend.listFeed).toHaveBeenCalledTimes(1))
    act(() => intersectAll())
    expect(backend.listFeed).toHaveBeenCalledTimes(1)
    release()
    await refetch
  })

  it('pages on past a first page made only of kinds the app drops', async () => {
    const backend = createFakeBackend()
    backend.listFeed = vi
      .fn()
      .mockResolvedValueOnce({
        items: [],
        rowCount: 20,
        newest: { sortAt: '2026-11-20T02:00:00+00:00', itemId: 'm-1' },
        oldest: { sortAt: '2026-11-20T01:00:00+00:00', itemId: 'm-20' },
      })
      .mockResolvedValueOnce({
        items: [feedCheckin()],
        rowCount: 1,
        newest: { sortAt: feedCheckin().sortAt, itemId: 'checkin-1' },
        oldest: { sortAt: feedCheckin().sortAt, itemId: 'checkin-1' },
      })
    renderRoutes(['/feed'], backend)
    await screen.findByRole('heading', { level: 1, name: 'Feed · Gym Rats' })
    await waitFor(() => expect(backend.listFeed).toHaveBeenCalledTimes(1))
    expect(screen.queryByText('Nothing stuck here yet.')).not.toBeInTheDocument()
    act(() => intersectAll())
    await waitFor(() => expect(articles()).toHaveLength(1))
  })

  it('stamps a saved wall against the time it opened, not the old fetch', async () => {
    const backend = createFakeBackend()
    // The refetch never answers: the wall shows what was saved yesterday.
    backend.listFeed = vi.fn(() => new Promise<never>(() => {}))
    const { createTestQueryClient } = await import('@/test/fake-backend')
    const client = createTestQueryClient()
    const yesterday = feedCheckin({ capturedAt: '2026-11-19T00:12:00.000Z' })
    client.setQueryData(
      ['feed', TEST_GROUP.id, 'wall'],
      { pages: [{ items: [yesterday], nextCursor: null }], pageParams: [null] },
      { updatedAt: Date.parse('2026-11-19T01:00:00Z') },
    )
    renderRoutes(['/feed'], backend, { queryClient: client })
    expect(
      await screen.findByRole('heading', { level: 2, name: 'Priya · Gym · Thu 08:12' }),
    ).toBeInTheDocument()
  })

  it('shows the empty state for an active group with nothing on the wall', async () => {
    renderFeed('/feed', [])
    expect(await screen.findByText('Nothing stuck here yet.')).toBeInTheDocument()
    expect(screen.getByText('The first check-in gets the front page.')).toBeInTheDocument()
  })

  it("shows the waiting block above the member's own items in a 1-member group", async () => {
    const own = feedCheckin({ authorId: TEST_USER.id, authorName: 'Jo' })
    renderFeed('/feed', [own], { groups: [{ ...TEST_GROUP, memberCount: 1 }] })
    expect(await screen.findByText('Just you in here so far.')).toBeInTheDocument()
    await waitFor(() => expect(articles()).toHaveLength(1))
    expect(screen.queryByText('Nothing stuck here yet.')).not.toBeInTheDocument()
  })

  it('puts the member\'s own waiting outbox entries on top as "sending…"', async () => {
    await putOutboxEntry({
      id: 'queued-1',
      userId: TEST_USER.id,
      groupId: TEST_GROUP.id,
      groupName: TEST_GROUP.name,
      commitmentId: 'c-gym',
      title: 'Gym',
      capturedAt: '2026-11-20T02:00:00.000Z',
      caption: 'still counts',
      firstQueuedAt: Date.now(),
      attempts: 0,
      rejection: null,
      photos: {
        1080: { bytes: new ArrayBuffer(4), type: 'image/webp' },
        360: { bytes: new ArrayBuffer(2), type: 'image/webp' },
      },
      uploaded: [],
      retryStreak: 0,
      // Backing off: the sender leaves it alone during the test.
      nextAttemptAt: Date.now() + 60 * 60_000,
    })
    renderFeed('/feed', [])
    const sending = await screen.findByRole('heading', { level: 2, name: 'You · Gym · sending…' })
    const article = sending.closest('article') as HTMLElement
    expect(within(article).getByText('sending…')).toBeInTheDocument()
    expect(within(article).getByText('still counts')).toBeInTheDocument()
    expect(within(article).queryByRole('button')).not.toBeInTheDocument()
  })

  it('shows "Photo didn\'t load." with Retry in the frame, and re-mints on Retry', async () => {
    const user = userEvent.setup()
    const { backend } = renderFeed('/feed', [feedCheckin()])
    const photo = await screen.findByRole('img', { name: /Priya's Gym check-in/ })
    fireEvent.error(photo)
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent("Photo didn't load.")
    const calls = vi.mocked(backend.signCheckinPhotos).mock.calls.length
    await user.click(within(alert).getByRole('button', { name: 'Retry' }))
    await waitFor(() =>
      expect(vi.mocked(backend.signCheckinPhotos).mock.calls.length).toBeGreaterThan(calls),
    )
  })

  it('with no way to sign, tries the cached copy, then says it loads once back online', async () => {
    const { backend } = renderFeed('/feed', [feedCheckin()])
    backend.signCheckinPhotos = vi.fn(async () => {
      throw new BackendError('network')
    })
    const photo = await screen.findByRole('img', { name: /Priya's Gym check-in/ })
    expect(photo.getAttribute('src')).toBe(
      `${FAKE_PHOTO_ORIGIN}/sign/${TEST_GROUP.id}/checkin-1/360.webp`,
    )
    // The cached copies with both candidates first, then the cached 360 alone, then the notice.
    expect(photo.getAttribute('srcset')).toMatch(/1080w$/)
    fireEvent.error(photo)
    const small = await screen.findByRole('img', { name: /Priya's Gym check-in/ })
    await waitFor(() => expect(small.getAttribute('srcset')).toBeNull())
    fireEvent.error(small)
    expect(await screen.findByText("Loads when you're back online.")).toBeInTheDocument()
  })
})

describe('Photo viewer', () => {
  it('opens full screen from the photo, closes by Close or Esc, and returns focus to the photo', async () => {
    const user = userEvent.setup()
    renderFeed('/feed', [feedCheckin()])
    const photo = await screen.findByRole('button', {
      name: "Priya's Gym check-in, 08:12, caption: leg day",
    })
    await user.click(photo)
    const viewer = await screen.findByRole('dialog', { name: 'Priya · Gym · 08:12' })
    expect(within(viewer).getByText('leg day')).toBeInTheDocument()
    expect(within(viewer).getByText('Priya · Gym · 2/3 · 08:12')).toBeInTheDocument()
    expect(within(viewer).getByRole('button', { name: 'Close' })).toHaveFocus()
    expect(within(viewer).queryByRole('link')).not.toBeInTheDocument()
    expect(within(viewer).getAllByRole('button')).toHaveLength(1)
    expect(await within(viewer).findByRole('img')).toHaveAttribute('draggable', 'false')

    await user.click(within(viewer).getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(photo).toHaveFocus()

    await user.click(photo)
    await screen.findByRole('dialog')
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(photo).toHaveFocus()
  })
})

describe('Feed deep link', () => {
  it('anchors on the check-in, focuses it and offers "See newest"', async () => {
    const items = feedCheckins(40)
    const { backend } = renderFeed(`/feed/c/${feedCheckinId(15)}?g=${TEST_GROUP.id}`, items)
    await waitFor(() => expect(articles()).toHaveLength(31))
    const anchor = document.querySelector(`[data-feed-item="${feedCheckinId(15)}"]`)
    expect(anchor).toHaveTextContent('post 15')
    await waitFor(() => expect(anchor).toHaveFocus())
    expect(screen.getByRole('link', { name: 'See newest' })).toHaveAttribute(
      'href',
      `/feed?g=${TEST_GROUP.id}`,
    )
    expect(backend.getFeedCheckin).toHaveBeenCalledWith(TEST_GROUP.id, feedCheckinId(15))
    // Shown as the Feed: the switcher and the active Feed tab.
    expect(
      screen.getByRole('button', { name: 'Group: Gym Rats, switch group' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Feed' })).toHaveAttribute('aria-current', 'page')
  })

  it('leaves quietly for the wall when a later refetch no longer finds the anchor', async () => {
    render(<Toaster />)
    const items = feedCheckins(5)
    const { backend, router, queryClient } = renderFeed(
      `/feed/c/${feedCheckinId(3)}?g=${TEST_GROUP.id}`,
      items,
    )
    const anchor = await waitFor(() => {
      const node = document.querySelector(`[data-feed-item="${feedCheckinId(3)}"]`)
      expect(node).toHaveFocus()
      return node
    })
    expect(anchor).toBeInTheDocument()
    backend.getFeedCheckin = vi.fn(async () => null)
    await act(() => queryClient.refetchQueries())
    await waitFor(() => expect(backend.getFeedCheckin).toHaveBeenCalled())
    await waitFor(() => expect(router.state.location.pathname).toBe('/feed'))
    expect(screen.queryByText("That's already wrapped up.")).not.toBeInTheDocument()
  })

  it('opens the Feed at the top with "That\'s already wrapped up." when the check-in is gone', async () => {
    render(<Toaster />)
    const { router } = renderFeed(`/feed/c/gone?g=${TEST_GROUP.id}`, [feedCheckin()])
    expect(await screen.findByText("That's already wrapped up.")).toBeInTheDocument()
    await waitFor(() => expect(router.state.location.pathname).toBe('/feed'))
    expect(router.state.location.search).toBe(`?g=${TEST_GROUP.id}`)
    await waitFor(() => expect(articles()).toHaveLength(1))
  })

  it('says "Switched to {Group}." when the link moved the focus to another group', async () => {
    render(<Toaster />)
    setStoredFocusedGroup('group-other')
    const other = {
      ...TEST_GROUP,
      id: 'group-other',
      name: 'Other',
      joinedAt: '2026-10-01T00:00:00.000Z',
    }
    renderFeed(
      `/feed/c/${feedCheckinId(1)}?g=${TEST_GROUP.id}`,
      [feedCheckin({ id: feedCheckinId(1) })],
      {
        groups: [other, TEST_GROUP],
      },
    )
    expect(await screen.findByText('Switched to Gym Rats.')).toBeInTheDocument()
  })
})
