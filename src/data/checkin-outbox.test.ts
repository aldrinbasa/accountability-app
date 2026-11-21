import type { CheckinPhotoSize, PostCheckinInput, PostCheckinResult } from '@/domain/checkin'
import { BackendError } from '@/domain/error-codes'
import {
  createCheckinOutbox,
  STORAGE_PERSIST_ASKED_KEY,
  type CheckinOutbox,
  type CheckinOutboxOptions,
  type NewOutboxEntry,
} from '@/data/checkin-outbox'
import {
  getOutboxEntry,
  listOutboxEntries,
  putOutboxEntry,
  type OutboxEntry,
  type OutboxPhoto,
} from '@/data/outbox-db'

const USER = 'user-a'

function photo(text: string): OutboxPhoto {
  return { bytes: new TextEncoder().encode(text).buffer as ArrayBuffer, type: 'image/webp' }
}

function entry(id: string, overrides: Partial<NewOutboxEntry> = {}): NewOutboxEntry {
  return {
    id,
    groupId: 'g1',
    groupName: 'Sunday Reset',
    commitmentId: 'c1',
    title: 'Gym',
    capturedAt: '2026-11-20T07:12:00.000Z',
    caption: null,
    photos: { 1080: photo('1080'), 360: photo('360') },
    ...overrides,
  }
}

function result(input: PostCheckinInput): PostCheckinResult {
  return {
    checkinId: input.id,
    sessionId: 's1',
    counted: true,
    isLate: false,
    weeklyPoints: null,
    rank: null,
    passedUserIds: [],
    doneCount: 1,
    target: 3,
  }
}

function fakeSender() {
  return {
    uploadCheckinPhoto: vi.fn(
      async (_groupId: string, _checkinId: string, _size: CheckinPhotoSize, _photo: Blob) => {},
    ),
    postCheckin: vi.fn(async (input: PostCheckinInput) => result(input)),
  }
}

/** Lets IndexedDB (setImmediate) and promise chains run until `done()` holds. */
async function until(done: () => boolean | Promise<boolean>, what = 'condition'): Promise<void> {
  const started = performance.now()
  while (performance.now() - started < 3_000) {
    if (await done()) return
    await new Promise((resolve) => setImmediate(resolve))
  }
  throw new Error(`timed out waiting for ${what}`)
}

function setOnline(online: boolean) {
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => online })
}

let now = 1_000_000
let outboxes: { outbox: CheckinOutbox; stop: () => void }[] = []

function start(options: Partial<CheckinOutboxOptions> = {}) {
  const backend = options.backend ?? fakeSender()
  const outbox = createCheckinOutbox({ userId: USER, backend, now: () => now, ...options })
  const stop = outbox.start()
  outboxes.push({ outbox, stop })
  return { outbox, backend: backend as ReturnType<typeof fakeSender> }
}

beforeEach(() => {
  now = 1_000_000
  setOnline(true)
})

afterEach(async () => {
  for (const { stop } of outboxes) stop()
  outboxes = []
  setOnline(true)
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('posting through the outbox', () => {
  it('writes the entry, uploads both renditions, posts, then deletes it', async () => {
    const persist = vi.fn(async () => true)
    Object.defineProperty(navigator, 'storage', { configurable: true, value: { persist } })
    const onSent = vi.fn()
    const { outbox, backend } = start({ onSent })
    await outbox.enqueue(entry('k1', { caption: 'leg day' }))
    expect(await outbox.firstAttempt('k1')).toBe('sent')

    expect(backend.uploadCheckinPhoto.mock.calls.map((call) => call.slice(0, 3))).toEqual([
      ['g1', 'k1', 1080],
      ['g1', 'k1', 360],
    ])
    expect(backend.postCheckin).toHaveBeenCalledWith({
      id: 'k1',
      groupId: 'g1',
      commitmentId: 'c1',
      capturedAt: '2026-11-20T07:12:00.000Z',
      caption: 'leg day',
    })
    expect(await getOutboxEntry('k1')).toBeUndefined()
    expect(onSent).toHaveBeenCalledTimes(1)
    expect(onSent.mock.calls[0]?.[0].entry.title).toBe('Gym')
    expect(onSent.mock.calls[0]?.[0].result.checkinId).toBe('k1')
    // storage.persist() once per device, on the first queued entry.
    expect(persist).toHaveBeenCalledTimes(1)
    expect(localStorage.getItem(STORAGE_PERSIST_ASKED_KEY)).toBe('1')
    await outbox.enqueue(entry('k2'))
    await outbox.firstAttempt('k2')
    expect(persist).toHaveBeenCalledTimes(1)
  })

  it('stores the photos as bytes with all the fields, attempts 0', async () => {
    setOnline(false)
    const { outbox } = start()
    await outbox.enqueue(entry('k1'))
    const stored = (await getOutboxEntry('k1')) as OutboxEntry
    expect(stored).toMatchObject({
      id: 'k1',
      userId: USER,
      groupId: 'g1',
      commitmentId: 'c1',
      capturedAt: '2026-11-20T07:12:00.000Z',
      caption: null,
      attempts: 0,
      firstQueuedAt: now,
      uploaded: [],
      rejection: null,
    })
    expect(new TextDecoder().decode(stored.photos?.[1080].bytes)).toBe('1080')
  })

  it('offline: nothing is sent and no attempt counts; `online` (a kick) sends it', async () => {
    setOnline(false)
    const { outbox, backend } = start()
    await outbox.enqueue(entry('k1'))
    expect(await outbox.firstAttempt('k1')).toBe('waiting')
    outbox.kick()
    await until(async () => outbox.getSnapshot().items.length === 1, 'the snapshot')
    expect(backend.uploadCheckinPhoto).not.toHaveBeenCalled()
    expect(outbox.getSnapshot().items[0]?.attempts).toBe(0)

    setOnline(true)
    outbox.kick()
    await until(() => backend.postCheckin.mock.calls.length === 1, 'the post')
    await until(async () => (await getOutboxEntry('k1')) === undefined, 'the delete')
  })

  it('sends the oldest first, one at a time', async () => {
    setOnline(false)
    const { outbox, backend } = start()
    now = 2_000
    await outbox.enqueue(entry('b-newer'))
    now = 1_000
    await outbox.enqueue(entry('z-older'))
    now = 1_000
    await outbox.enqueue(entry('a-same-time'))
    now = 5_000
    setOnline(true)
    outbox.kick()
    await until(() => backend.postCheckin.mock.calls.length === 3, 'three posts')
    expect(backend.postCheckin.mock.calls.map((call) => call[0].id)).toEqual([
      'a-same-time',
      'z-older',
      'b-newer',
    ])
  })

  it("sends only the signed-in user's entries", async () => {
    await putOutboxEntry({
      ...entry('other'),
      userId: 'user-b',
      firstQueuedAt: 1,
      attempts: 0,
      rejection: null,
      uploaded: [],
      retryStreak: 0,
      nextAttemptAt: 0,
    })
    const { outbox, backend } = start()
    await outbox.enqueue(entry('mine'))
    await outbox.firstAttempt('mine')
    expect(backend.postCheckin.mock.calls.map((call) => call[0].id)).toEqual(['mine'])
    expect(await getOutboxEntry('other')).toBeDefined()
    await until(() => outbox.getSnapshot().items.length === 0, 'the snapshot')
  })
})

describe('retries', () => {
  it('backs off 5 s, 10 s … after failed sends; the timer wakes the sender', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const backend = fakeSender()
    backend.postCheckin.mockRejectedValue(new BackendError('network'))
    const { outbox } = start({ backend })
    await outbox.enqueue(entry('k1'))
    expect(await outbox.firstAttempt('k1')).toBe('waiting')
    let stored = (await getOutboxEntry('k1')) as OutboxEntry
    expect(stored).toMatchObject({ attempts: 1, retryStreak: 1, nextAttemptAt: now + 5_000 })
    // The renditions landed: only the post is repeated.
    expect(stored.uploaded).toEqual([1080, 360])

    // Not due yet: a kick does nothing.
    outbox.kick()
    await until(async () => outbox.getSnapshot().items[0]?.attempts === 1, 'the snapshot')
    expect(backend.postCheckin).toHaveBeenCalledTimes(1)

    now += 5_000
    await vi.advanceTimersByTimeAsync(5_000)
    await until(() => backend.postCheckin.mock.calls.length === 2, 'the second try')
    await until(async () => (await getOutboxEntry('k1'))?.attempts === 2, 'attempt 2')
    stored = (await getOutboxEntry('k1')) as OutboxEntry
    expect(stored).toMatchObject({ retryStreak: 2, nextAttemptAt: now + 10_000 })
    expect(backend.uploadCheckinPhoto).toHaveBeenCalledTimes(2)
  })

  it('Retry sends at once and resets the backoff', async () => {
    const backend = fakeSender()
    backend.postCheckin.mockRejectedValueOnce(new BackendError('unknown'))
    backend.postCheckin.mockRejectedValueOnce(new BackendError('unknown'))
    const { outbox } = start({ backend })
    await outbox.enqueue(entry('k1'))
    await outbox.firstAttempt('k1')
    outbox.retry()
    await until(() => backend.postCheckin.mock.calls.length === 2, 'the retry')
    await until(async () => (await getOutboxEntry('k1'))?.attempts === 2, 'attempt 2')
    // The streak restarted at the Retry: back to a 5 s wait.
    expect(await getOutboxEntry('k1')).toMatchObject({ retryStreak: 1, nextAttemptAt: now + 5_000 })
    outbox.retry()
    await until(async () => (await getOutboxEntry('k1')) === undefined, 'the send')
  })

  it('photo_missing uploads both renditions again on the next try', async () => {
    const backend = fakeSender()
    backend.postCheckin.mockRejectedValueOnce(new BackendError('photo_missing'))
    const { outbox } = start({ backend })
    await outbox.enqueue(entry('k1'))
    expect(await outbox.firstAttempt('k1')).toBe('waiting')
    expect((await getOutboxEntry('k1'))?.uploaded).toEqual([])
    outbox.retry()
    await until(async () => (await getOutboxEntry('k1')) === undefined, 'the send')
    expect(backend.uploadCheckinPhoto).toHaveBeenCalledTimes(4)
  })

  it('an upload that fails keeps what landed and retries the rest', async () => {
    const backend = fakeSender()
    backend.uploadCheckinPhoto.mockResolvedValueOnce(undefined)
    backend.uploadCheckinPhoto.mockRejectedValueOnce(new BackendError('network'))
    const { outbox } = start({ backend })
    await outbox.enqueue(entry('k1'))
    expect(await outbox.firstAttempt('k1')).toBe('waiting')
    expect((await getOutboxEntry('k1'))?.uploaded).toEqual([1080])
    outbox.retry()
    await until(async () => (await getOutboxEntry('k1')) === undefined, 'the send')
    expect(backend.uploadCheckinPhoto.mock.calls.map((call) => call[2])).toEqual([1080, 360, 360])
  })

  it('counts failed attempts across tries (3 = "Couldn\'t send yet.")', async () => {
    const backend = fakeSender()
    backend.postCheckin.mockRejectedValue(new BackendError('network'))
    const { outbox } = start({ backend })
    await outbox.enqueue(entry('k1'))
    await outbox.firstAttempt('k1')
    for (const expected of [2, 3]) {
      outbox.retry()
      await until(async () => (await getOutboxEntry('k1'))?.attempts === expected, `${expected}`)
    }
    await until(() => outbox.getSnapshot().items[0]?.attempts === 3, 'the snapshot')
  })

  it('flags the sender as running only while it uploads or posts', async () => {
    const onRunningChange = vi.fn()
    const { outbox } = start({ onRunningChange })
    await outbox.enqueue(entry('k1'))
    await outbox.firstAttempt('k1')
    await until(() => onRunningChange.mock.calls.length >= 2, 'running off')
    expect(onRunningChange.mock.calls.map((call) => call[0])).toEqual([true, false])
  })
})

describe('rejections', () => {
  it('a terminal code rejects the entry, drops its photo, never retries; Got it deletes it', async () => {
    const backend = fakeSender()
    backend.postCheckin.mockRejectedValue(
      new BackendError(
        'week_locked',
        'week_locked',
        '{"lock_at" : "2026-11-26T00:00:00+00:00", "time_zone" : "Europe/London"}',
      ),
    )
    const { outbox } = start({ backend })
    await outbox.enqueue(entry('k1'))
    expect(await outbox.firstAttempt('k1')).toBe('rejected')
    expect(await getOutboxEntry('k1')).toMatchObject({
      photos: null,
      rejection: {
        code: 'week_locked',
        lockAt: '2026-11-26T00:00:00+00:00',
        timeZone: 'Europe/London',
      },
    })
    outbox.retry()
    outbox.kick()
    await until(() => outbox.getSnapshot().items[0]?.rejection !== null, 'the snapshot')
    expect(backend.postCheckin).toHaveBeenCalledTimes(1)

    await outbox.dismiss('k1')
    expect(await getOutboxEntry('k1')).toBeUndefined()
    expect(outbox.getSnapshot().items).toEqual([])
  })

  it.each([
    'commitment_ended',
    'not_member',
    'session_frozen',
    'bad_capture_time',
    'checkin_conflict',
    'invalid_caption',
  ] as const)('%s is terminal', async (code) => {
    const backend = fakeSender()
    backend.postCheckin.mockRejectedValue(new BackendError(code))
    const { outbox } = start({ backend })
    await outbox.enqueue(entry('k1'))
    expect(await outbox.firstAttempt('k1')).toBe('rejected')
    expect((await getOutboxEntry('k1'))?.rejection?.code).toBe(code)
  })
})

describe('sign-out', () => {
  it("clear deletes only this user's entries and stops sending", async () => {
    setOnline(false)
    await putOutboxEntry({
      ...entry('other'),
      userId: 'user-b',
      firstQueuedAt: 1,
      attempts: 0,
      rejection: null,
      uploaded: [],
      retryStreak: 0,
      nextAttemptAt: 0,
    })
    const { outbox, backend } = start()
    await outbox.enqueue(entry('k1'))
    await outbox.enqueue(entry('k2'))
    await outbox.clear()
    expect(await listOutboxEntries(USER)).toEqual([])
    expect((await listOutboxEntries('user-b')).map((e) => e.id)).toEqual(['other'])
    setOnline(true)
    outbox.kick()
    await new Promise((resolve) => setImmediate(resolve))
    expect(backend.postCheckin).not.toHaveBeenCalled()
  })
})

describe('review fixes', () => {
  it('offline with a due entry: no timer is armed, so the sender does not spin', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    setOnline(false)
    const { outbox, backend } = start()
    await outbox.enqueue(entry('k1'))
    expect(await outbox.firstAttempt('k1')).toBe('waiting')
    outbox.kick()
    await until(() => outbox.getSnapshot().items.length === 1, 'the snapshot')
    for (let i = 0; i < 20; i += 1) await new Promise((resolve) => setImmediate(resolve))
    expect(vi.getTimerCount()).toBe(0)
    expect(backend.uploadCheckinPhoto).not.toHaveBeenCalled()
  })

  it.each(['resolves', 'rejects'] as const)(
    'a sign-out during an upload: the upload %s, nothing is written back or posted',
    async (how) => {
      const backend = fakeSender()
      let finish: () => void = () => {}
      backend.uploadCheckinPhoto.mockImplementationOnce(
        () =>
          new Promise<void>((resolve, reject) => {
            finish = () => (how === 'resolves' ? resolve() : reject(new BackendError('network')))
          }),
      )
      const onSent = vi.fn()
      const { outbox } = start({ backend, onSent })
      await outbox.enqueue(entry('k1'))
      await until(() => backend.uploadCheckinPhoto.mock.calls.length === 1, 'the upload')
      await outbox.clear()
      finish()
      await outbox.firstAttempt('k1')
      for (let i = 0; i < 20; i += 1) await new Promise((resolve) => setImmediate(resolve))
      expect(await getOutboxEntry('k1')).toBeUndefined()
      expect(backend.postCheckin).not.toHaveBeenCalled()
      expect(onSent).not.toHaveBeenCalled()
    },
  )

  it('a post that lands after sign-out plays no moment', async () => {
    const backend = fakeSender()
    let finish: () => void = () => {}
    backend.postCheckin.mockImplementationOnce(
      (input: PostCheckinInput) =>
        new Promise<PostCheckinResult>((resolve) => {
          finish = () => resolve(result(input))
        }),
    )
    const onSent = vi.fn()
    const { outbox } = start({ backend, onSent })
    await outbox.enqueue(entry('k1'))
    await until(() => backend.postCheckin.mock.calls.length === 1, 'the post')
    await outbox.clear()
    finish()
    await outbox.firstAttempt('k1')
    for (let i = 0; i < 20; i += 1) await new Promise((resolve) => setImmediate(resolve))
    expect(onSent).not.toHaveBeenCalled()
    expect(await getOutboxEntry('k1')).toBeUndefined()
  })

  it('Retry while an entry is being sent does not revive it after its delete', async () => {
    const backend = fakeSender()
    let finish: () => void = () => {}
    backend.postCheckin.mockImplementationOnce(
      (input: PostCheckinInput) =>
        new Promise<PostCheckinResult>((resolve) => {
          finish = () => resolve(result(input))
        }),
    )
    const onSent = vi.fn()
    const { outbox } = start({ backend, onSent })
    await outbox.enqueue(entry('k1'))
    await until(() => backend.postCheckin.mock.calls.length === 1, 'the post')
    outbox.retry()
    for (let i = 0; i < 20; i += 1) await new Promise((resolve) => setImmediate(resolve))
    finish()
    expect(await outbox.firstAttempt('k1')).toBe('sent')
    for (let i = 0; i < 40; i += 1) await new Promise((resolve) => setImmediate(resolve))
    expect(await getOutboxEntry('k1')).toBeUndefined()
    expect(backend.postCheckin).toHaveBeenCalledTimes(1)
    expect(onSent).toHaveBeenCalledTimes(1)
  })

  it('counts the waiting photos from the store', async () => {
    setOnline(false)
    const { outbox } = start()
    await outbox.enqueue(entry('k1'))
    await outbox.enqueue(entry('k2'))
    expect(await outbox.countWaiting()).toBe(2)
  })
})
