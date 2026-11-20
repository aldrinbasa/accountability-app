import { describe, expect, it } from 'vitest'
import { createFeedRepository } from '@/data/feed'
import { createFakeBackend } from '@/test/fake-backend'
import { feedCheckinId, feedCheckins, feedEvent } from '@/test/feed-items'

describe('feed repository', () => {
  it('pages 20 at a time by keyset, newest first, and stops at the end', async () => {
    const items = feedCheckins(25)
    const backend = createFakeBackend(undefined, { feed: { 'group-1': items } })
    const repository = createFeedRepository(backend)

    const first = await repository.page('group-1', null)
    expect(first.items.map((item) => item.id)).toEqual(items.slice(0, 20).map((item) => item.id))
    expect(first.nextCursor).toEqual({ sortAt: items[19]?.sortAt, itemId: items[19]?.id })
    expect(backend.listFeed).toHaveBeenLastCalledWith('group-1', { limit: 20 })

    const second = await repository.page('group-1', first.nextCursor)
    expect(second.items.map((item) => item.id)).toEqual(items.slice(20).map((item) => item.id))
    expect(second.nextCursor).toBeNull()
    expect(backend.listFeed).toHaveBeenLastCalledWith('group-1', {
      before: first.nextCursor,
      limit: 20,
    })
  })

  it('keeps paging past rows the adapter dropped (raw row count and cursor)', async () => {
    const backend = createFakeBackend()
    backend.listFeed = vi.fn(async () => ({
      items: [],
      rowCount: 20,
      newest: { sortAt: 'b', itemId: 'x' },
      oldest: { sortAt: 'a', itemId: 'y' },
    }))
    const page = await createFeedRepository(backend).page('group-1', null)
    expect(page.items).toEqual([])
    expect(page.nextCursor).toEqual({ sortAt: 'a', itemId: 'y' })
  })

  it('anchors on a check-in: up to 10 newer, the check-in, up to 20 older', async () => {
    const items = [...feedCheckins(40)]
    const anchor = items[15]
    if (!anchor) throw new Error('no anchor')
    const backend = createFakeBackend(undefined, { feed: { 'group-1': items } })
    const page = await createFeedRepository(backend).around('group-1', anchor.id)

    expect(page.anchorFound).toBe(true)
    expect(page.hasNewer).toBe(true)
    expect(page.items.map((item) => item.id)).toEqual(items.slice(5, 36).map((item) => item.id))
    expect(page.nextCursor).toEqual({ sortAt: items[35]?.sortAt, itemId: items[35]?.id })
  })

  it('anchored on the newest item: nothing newer, and the end of the wall', async () => {
    const items = [...feedCheckins(3), feedEvent()]
    const backend = createFakeBackend(undefined, { feed: { 'group-1': items } })
    const page = await createFeedRepository(backend).around('group-1', feedCheckinId(1))
    expect(page.hasNewer).toBe(false)
    expect(page.items.map((item) => item.id)).toEqual([
      feedCheckinId(1),
      feedCheckinId(2),
      feedCheckinId(3),
      'event-1',
    ])
    expect(page.nextCursor).toBeNull()
  })

  it('reports a gone, hidden or other-group check-in as not found', async () => {
    const backend = createFakeBackend(undefined, { feed: { 'group-1': feedCheckins(3) } })
    const page = await createFeedRepository(backend).around('group-1', feedCheckinId(99))
    expect(page).toEqual({ items: [], nextCursor: null, hasNewer: false, anchorFound: false })
    expect(backend.getFeedCheckin).toHaveBeenCalledWith('group-1', feedCheckinId(99))
    expect(backend.listFeed).not.toHaveBeenCalled()
  })

  it('treats a malformed id as not found without asking the backend', async () => {
    const backend = createFakeBackend(undefined, { feed: { 'group-1': feedCheckins(3) } })
    const page = await createFeedRepository(backend).around('group-1', 'not-a-uuid')
    expect(page.anchorFound).toBe(false)
    expect(backend.getFeedCheckin).not.toHaveBeenCalled()
    expect(backend.listFeed).not.toHaveBeenCalled()
  })
})
