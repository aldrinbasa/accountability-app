import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { CheckinPhotoSize } from '@/domain/checkin'
import type { OutboxItem } from '@/domain/outbox'

/**
 * The check-in outbox's device store (Story 3.3, AD-12): IndexedDB database `proofy-outbox`, object
 * store `checkin_outbox`, separate from the query cache. The app never prunes it: an entry goes only
 * when its post succeeds, when the member taps Got it on a rejection, or on a confirmed sign-out.
 */

/** One rendition's bytes. Kept as an `ArrayBuffer` (Blobs in IndexedDB have had WebKit bugs). */
export interface OutboxPhoto {
  bytes: ArrayBuffer
  type: string
}

/** What the store holds per check-in. */
export interface OutboxEntry extends OutboxItem {
  userId: string
  /** Both renditions until the post succeeds; null once the entry was rejected. */
  photos: Record<CheckinPhotoSize, OutboxPhoto> | null
  /** Renditions already in Storage (not uploaded again; cleared on `photo_missing`). */
  uploaded: CheckinPhotoSize[]
  /** Failed sends in a row since the last Retry: the backoff step. */
  retryStreak: number
  /** `Date.now()` from which the sender may try again. */
  nextAttemptAt: number
}

export const OUTBOX_DB_NAME = 'proofy-outbox'
export const OUTBOX_STORE = 'checkin_outbox'

interface OutboxSchema extends DBSchema {
  checkin_outbox: {
    key: string
    value: OutboxEntry
    indexes: { by_user: string }
  }
}

let dbPromise: Promise<IDBPDatabase<OutboxSchema>> | null = null

function db(): Promise<IDBPDatabase<OutboxSchema>> {
  dbPromise ??= openDB<OutboxSchema>(OUTBOX_DB_NAME, 1, {
    upgrade(database) {
      const store = database.createObjectStore(OUTBOX_STORE, { keyPath: 'id' })
      store.createIndex('by_user', 'userId')
    },
    // Another tab upgraded the database: let it, and reopen next time.
    blocking() {
      void dbPromise?.then((open) => open.close())
      dbPromise = null
    },
  }).catch((error: unknown) => {
    dbPromise = null
    throw error
  })
  return dbPromise
}

export async function putOutboxEntry(entry: OutboxEntry): Promise<void> {
  await (await db()).put(OUTBOX_STORE, entry)
}

export async function getOutboxEntry(id: string): Promise<OutboxEntry | undefined> {
  return (await db()).get(OUTBOX_STORE, id)
}

/** A user's entries, in no particular order. */
export async function listOutboxEntries(userId: string): Promise<OutboxEntry[]> {
  return (await db()).getAllFromIndex(OUTBOX_STORE, 'by_user', userId)
}

export async function deleteOutboxEntry(id: string): Promise<void> {
  await (await db()).delete(OUTBOX_STORE, id)
}

/** Deletes every entry of `userId` (a confirmed sign-out). Other accounts' entries stay. */
export async function clearOutboxEntries(userId: string): Promise<void> {
  const database = await db()
  const tx = database.transaction(OUTBOX_STORE, 'readwrite')
  const keys = await tx.store.index('by_user').getAllKeys(userId)
  await Promise.all([...keys.map((key) => tx.store.delete(key)), tx.done])
}

/** Tests only: close the connection so the next call opens a fresh database. */
export async function resetOutboxDb(): Promise<void> {
  const open = dbPromise
  dbPromise = null
  if (open) (await open.catch(() => null))?.close()
}
