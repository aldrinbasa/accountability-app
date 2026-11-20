import { createContext, useContext, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import {
  CHECKIN_PHOTO_SIZES,
  type CheckinPhotoSize,
  type PostCheckinResult,
} from '@/domain/checkin'
import { backendErrorCode, isBackendError } from '@/domain/error-codes'
import {
  backoffDelay,
  compareSendOrder,
  isTerminalPostError,
  toRejection,
  type OutboxItem,
} from '@/domain/outbox'
import type { BackendPort } from '@/ports/backend-port'
import { useBackendContext } from '@/data/backend-context-value'
import { isOffline } from '@/data/connectivity'
import { readDevice, writeDevice } from '@/data/device-storage'
import {
  clearOutboxEntries,
  deleteOutboxEntry,
  getOutboxEntry,
  listOutboxEntries,
  putOutboxEntry,
  type OutboxEntry,
  type OutboxPhoto,
} from '@/data/outbox-db'

/**
 * The check-in outbox and its sender (Story 3.3, FR-13). Every Post writes an entry first (both
 * WebP renditions, the id and caption frozen at the first Post); the sender then uploads what has
 * not landed and calls `post_checkin`. Only the sender calls `uploadCheckinPhoto` / `postCheckin`.
 *
 * Sends happen only while `navigator.onLine` is not false, for the signed-in user's entries only,
 * one at a time, oldest first, each when its backoff is over (5 s doubling to 5 min after each
 * failed send; Retry resets it). A send that fails with a terminal code rejects the entry (its photo
 * is dropped at once; the entry stays only for its Banner until Got it). Anything else retries;
 * `photo_missing` uploads both renditions again. An upload that already exists counts as done.
 */

/** How the first send of a just-posted entry ended. */
export type FirstAttempt = 'sent' | 'waiting' | 'rejected'

/** A new entry, as the Post flow writes it. */
export interface NewOutboxEntry {
  id: string
  groupId: string
  groupName: string
  commitmentId: string
  title: string
  capturedAt: string
  caption: string | null
  photos: Record<CheckinPhotoSize, OutboxPhoto>
}

/** A send the server accepted, with the entry (and its photos) as it was sent. */
export interface SentCheckin {
  entry: OutboxEntry
  result: PostCheckinResult
}

export interface OutboxSnapshot {
  /** The entries have been read from the device at least once. */
  loaded: boolean
  /** The user's entries without photo bytes, in send order. */
  items: OutboxItem[]
}

export interface CheckinOutbox {
  readonly userId: string
  /** Follows the store and runs a first pass. Returns the stop function (StrictMode-safe). */
  start(): () => void
  /** Writes the entry, then wakes the sender. Rejects only when the device store refuses it. */
  enqueue(entry: NewOutboxEntry): Promise<void>
  /** Settles when the sender's first attempt for a just-queued entry ends (or the pass ends without one). */
  firstAttempt(id: string): Promise<FirstAttempt>
  /** Run a pass now (app start, focus, `online`). */
  kick(): void
  /** Retry: every waiting entry is due now with its backoff reset, then a pass runs. */
  retry(): void
  /** Got it on a rejection: the entry is deleted. */
  dismiss(id: string): Promise<void>
  /** Confirmed sign-out: stop sending and delete every entry of this user. */
  clear(): Promise<void>
  /** How many photos wait to be sent, read from the store (not the snapshot, which may not be loaded). */
  countWaiting(): Promise<number>
  getSnapshot(): OutboxSnapshot
  subscribe(listener: () => void): () => void
}

export interface CheckinOutboxOptions {
  userId: string
  backend: Pick<BackendPort, 'uploadCheckinPhoto' | 'postCheckin'>
  /** A send the server accepted (the entry is already deleted). */
  onSent?: (sent: SentCheckin) => void
  /** True while a pass uploads or posts (the "Update ready" toast waits). */
  onRunningChange?: (running: boolean) => void
  /** The clock (tests). */
  now?: () => number
}

/** Device flag: `navigator.storage.persist()` was asked once on this device. */
export const STORAGE_PERSIST_ASKED_KEY = 'proofy.storagePersistAsked'

function requestPersistentStorageOnce(): void {
  if (readDevice(STORAGE_PERSIST_ASKED_KEY) !== null) return
  writeDevice(STORAGE_PERSIST_ASKED_KEY, '1')
  try {
    void navigator.storage?.persist?.().catch(() => {})
  } catch {
    // Not supported: the browser decides.
  }
}

/** A rendition as stored bytes (`ArrayBuffer`, never a Blob in IndexedDB). */
export async function toOutboxPhoto(blob: Blob): Promise<OutboxPhoto> {
  const bytes =
    typeof blob.arrayBuffer === 'function'
      ? await blob.arrayBuffer()
      : await new Response(blob).arrayBuffer()
  return { bytes, type: blob.type }
}

export function outboxPhotoBlob(photo: OutboxPhoto): Blob {
  return new Blob([photo.bytes], { type: photo.type })
}

function toItem(entry: OutboxEntry): OutboxItem {
  return {
    id: entry.id,
    groupId: entry.groupId,
    groupName: entry.groupName,
    commitmentId: entry.commitmentId,
    title: entry.title,
    capturedAt: entry.capturedAt,
    caption: entry.caption,
    firstQueuedAt: entry.firstQueuedAt,
    attempts: entry.attempts,
    rejection: entry.rejection,
  }
}

function sameItems(a: readonly OutboxItem[], b: readonly OutboxItem[]): boolean {
  return (
    a.length === b.length &&
    a.every((item, index) => {
      const other = b[index]
      return (
        other !== undefined &&
        item.id === other.id &&
        item.attempts === other.attempts &&
        item.rejection?.code === other.rejection?.code
      )
    })
  )
}

/** Waiting to be sent: not rejected and still holding its photos. */
function sendable(entry: OutboxEntry): boolean {
  return entry.rejection === null && entry.photos !== null
}

interface Waiter {
  promise: Promise<FirstAttempt>
  resolve: (outcome: FirstAttempt) => void
}

export function createCheckinOutbox({
  userId,
  backend,
  onSent,
  onRunningChange,
  now = Date.now,
}: CheckinOutboxOptions): CheckinOutbox {
  let snapshot: OutboxSnapshot = { loaded: false, items: [] }
  const listeners = new Set<() => void>()
  const waiters = new Map<string, Waiter>()
  const outcomes = new Map<string, FirstAttempt>()
  let active = false
  // Bumped when sending stops (stop, clear): a send that was in flight then writes nothing back.
  let generation = 0
  let running = false
  let rerun = false
  let busy = false
  let timer: ReturnType<typeof setTimeout> | null = null
  let nextDue: number | null = null
  let refreshSeq = 0
  // Backoff kept in memory too, so a failed store write never makes an entry due at once again.
  const notBefore = new Map<string, number>()
  // The entry being sent now (Retry leaves it alone).
  let inFlight: string | null = null

  function dueAt(entry: OutboxEntry): number {
    return Math.max(entry.nextAttemptAt, notBefore.get(entry.id) ?? 0)
  }

  function emit() {
    for (const listener of listeners) listener()
  }

  function setBusy(next: boolean) {
    if (busy === next) return
    busy = next
    onRunningChange?.(next)
  }

  async function refresh(): Promise<void> {
    const seq = ++refreshSeq
    let entries: OutboxEntry[]
    try {
      entries = await listOutboxEntries(userId)
    } catch {
      // Unreadable for now: keep showing what was there, but arm no timer from stale data (the
      // next focus, `online` or new entry tries again).
      if (seq === refreshSeq) nextDue = null
      return
    }
    if (seq !== refreshSeq) return
    entries.sort(compareSendOrder)
    const due = entries.filter(sendable).map(dueAt)
    nextDue = due.length > 0 ? Math.min(...due) : null
    const items = entries.map(toItem)
    if (snapshot.loaded && sameItems(snapshot.items, items)) return
    snapshot = { loaded: true, items }
    emit()
  }

  function settle(id: string, outcome: FirstAttempt) {
    outcomes.set(id, outcome)
    const waiter = waiters.get(id)
    if (!waiter) return
    waiters.delete(id)
    waiter.resolve(outcome)
  }

  function clearTimer() {
    if (timer !== null) clearTimeout(timer)
    timer = null
  }

  function schedule() {
    clearTimer()
    // Offline, the `online` event wakes the sender; no timer (it would only spin).
    if (!active || nextDue === null || !Number.isFinite(nextDue) || isOffline()) return
    timer = setTimeout(kick, Math.max(0, nextDue - now()))
  }

  async function sendOne(start: OutboxEntry): Promise<void> {
    const gen = generation
    let entry = start
    const photos = entry.photos
    if (!photos) return
    setBusy(true)
    inFlight = entry.id
    try {
      for (const size of CHECKIN_PHOTO_SIZES) {
        if (entry.uploaded.includes(size)) continue
        await backend.uploadCheckinPhoto(
          entry.groupId,
          entry.id,
          size,
          outboxPhotoBlob(photos[size]),
        )
        // Signed out (or stopped) meanwhile: write nothing back, post nothing.
        if (gen !== generation) return
        entry = { ...entry, uploaded: [...entry.uploaded, size] }
        await putOutboxEntry(entry)
        if (gen !== generation) return
      }
      const result = await backend.postCheckin({
        id: entry.id,
        groupId: entry.groupId,
        commitmentId: entry.commitmentId,
        capturedAt: entry.capturedAt,
        caption: entry.caption,
      })
      // The photo is deleted only now that the post succeeded.
      const deleted = await deleteOutboxEntry(entry.id).then(
        () => true,
        () => false,
      )
      // A delete that failed leaves the entry in the store: never send it again this session.
      if (deleted) notBefore.delete(entry.id)
      else notBefore.set(entry.id, Number.POSITIVE_INFINITY)
      // Signed out (or stopped) while it was sending: no moment, no refetch for that session.
      if (gen !== generation) {
        settle(entry.id, 'waiting')
        return
      }
      try {
        onSent?.({ entry, result })
      } catch {
        // The post stands; only the moment or a refetch failed to start.
      }
      settle(entry.id, 'sent')
    } catch (error) {
      if (gen !== generation) return
      const code = backendErrorCode(error)
      // Signed out or dismissed meanwhile: nothing to write back.
      const stored = await getOutboxEntry(entry.id).catch(() => undefined)
      if (gen !== generation) return
      if (!stored) {
        settle(entry.id, 'waiting')
        return
      }
      if (isTerminalPostError(code)) {
        const detail = isBackendError(error) ? error.detail : null
        // Final: even if the write below fails, this session never sends it again.
        notBefore.set(entry.id, Number.POSITIVE_INFINITY)
        await putOutboxEntry({
          ...entry,
          photos: null,
          uploaded: [],
          attempts: entry.attempts + 1,
          rejection: toRejection(code, detail),
        })
        settle(entry.id, 'rejected')
      } else {
        const streak = stored.retryStreak + 1
        notBefore.set(entry.id, now() + backoffDelay(streak))
        await putOutboxEntry({
          ...entry,
          // The server found no photo: upload both renditions again next time.
          uploaded: code === 'photo_missing' ? [] : entry.uploaded,
          attempts: entry.attempts + 1,
          retryStreak: streak,
          nextAttemptAt: now() + backoffDelay(streak),
        })
        settle(entry.id, 'waiting')
      }
    } finally {
      inFlight = null
    }
  }

  async function pass(): Promise<void> {
    // One attempt per entry per pass: a store that cannot be written never loops.
    const attempted = new Set<string>()
    for (;;) {
      if (!active || isOffline()) return
      const entries = (await listOutboxEntries(userId)).filter(sendable).sort(compareSendOrder)
      const due = entries.find((entry) => dueAt(entry) <= now() && !attempted.has(entry.id))
      if (!due) return
      attempted.add(due.id)
      await sendOne(due)
      await refresh()
    }
  }

  async function run(): Promise<void> {
    if (running) {
      rerun = true
      return
    }
    running = true
    try {
      do {
        rerun = false
        await pass().catch(() => {})
      } while (rerun && active)
    } finally {
      running = false
      setBusy(false)
      // Entries queued for this pass that it did not try (offline, or the store failed): waiting.
      for (const id of [...waiters.keys()]) settle(id, 'waiting')
      await refresh()
      schedule()
    }
  }

  function kick() {
    if (!active) return
    void run()
  }

  return {
    userId,
    start() {
      active = true
      void refresh().then(schedule)
      kick()
      return () => {
        active = false
        generation += 1
        clearTimer()
        setBusy(false)
      }
    },
    async enqueue(entry) {
      const at = now()
      await putOutboxEntry({
        ...entry,
        userId,
        firstQueuedAt: at,
        attempts: 0,
        rejection: null,
        uploaded: [],
        retryStreak: 0,
        nextAttemptAt: at,
      })
      // Registered once the entry is stored, so a pass that ends before it cannot settle it early.
      let resolve: (outcome: FirstAttempt) => void = () => {}
      const promise = new Promise<FirstAttempt>((done) => {
        resolve = done
      })
      waiters.set(entry.id, { promise, resolve })
      requestPersistentStorageOnce()
      void refresh()
      if (active) kick()
      else settle(entry.id, 'waiting')
    },
    firstAttempt(id) {
      const waiter = waiters.get(id)
      if (waiter) return waiter.promise
      return Promise.resolve(outcomes.get(id) ?? 'waiting')
    },
    kick,
    retry() {
      void (async () => {
        try {
          // The entry being sent now is left alone (re-writing it could revive it after its delete).
          const entries = (await listOutboxEntries(userId)).filter(
            (entry) => sendable(entry) && entry.id !== inFlight,
          )
          for (const entry of entries) notBefore.delete(entry.id)
          await Promise.all(
            entries.map((entry) =>
              putOutboxEntry({ ...entry, retryStreak: 0, nextAttemptAt: now() }),
            ),
          )
        } catch {
          // The pass below still tries whatever is due.
        }
        kick()
      })()
    },
    async dismiss(id) {
      await deleteOutboxEntry(id).catch(() => {})
      await refresh()
    },
    async clear() {
      active = false
      generation += 1
      clearTimer()
      setBusy(false)
      await clearOutboxEntries(userId)
      snapshot = { loaded: true, items: [] }
      emit()
    },
    async countWaiting() {
      return (await listOutboxEntries(userId)).filter(sendable).length
    },
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}

const OutboxContext = createContext<CheckinOutbox | null>(null)

/** Provided by the signed-in shell (`src/app/outbox-host.tsx`). */
export const OutboxProvider = OutboxContext.Provider

/** The signed-in user's outbox; `hook` names the caller in the error. */
export function useCheckinOutbox(hook: string): CheckinOutbox {
  const outbox = useContext(OutboxContext)
  if (!outbox) throw new Error(`${hook} must be used inside <OutboxProvider>`)
  return outbox
}

/** The outbox snapshot: whether the entries were read yet, and the items. */
export function useOutboxSnapshot(): OutboxSnapshot {
  const outbox = useCheckinOutbox('useOutboxSnapshot')
  return useSyncExternalStore(outbox.subscribe, outbox.getSnapshot)
}

/** The user's entries (no photo bytes), in send order. */
export function useOutboxItems(): OutboxItem[] {
  return useOutboxSnapshot().items
}

export interface OutboxHandlers {
  /** A send the server accepted (also later, background sends). */
  onSent?: (sent: SentCheckin) => void
  /** True while a pass uploads or posts. */
  onRunningChange?: (running: boolean) => void
}

/**
 * Creates the signed-in user's outbox over the shared backend, started while mounted. The handlers
 * may change between renders; the latest ones are called.
 */
export function useCheckinOutboxForUser(userId: string, handlers: OutboxHandlers): CheckinOutbox {
  const { backend } = useBackendContext('useCheckinOutboxForUser')
  const latest = useRef(handlers)
  useEffect(() => {
    latest.current = handlers
  })
  const [outbox] = useState(() =>
    createCheckinOutbox({
      userId,
      backend,
      onSent: (sent) => latest.current.onSent?.(sent),
      onRunningChange: (running) => latest.current.onRunningChange?.(running),
    }),
  )
  useEffect(() => outbox.start(), [outbox])
  return outbox
}
