/**
 * One sheet at a time, and system back closes it.
 *
 * Opening a sheet pushes one `{ sheet: true }` history entry, so Android back (and the browser back
 * button) pops that entry and closes the sheet instead of leaving the screen. Closing the sheet any
 * other way (close button, Esc, scrim, swipe) calls `history.back()` once to drop the entry again.
 * Opening a second sheet closes the first and reuses its history entry.
 */
export interface SheetHandle {
  /** Close immediately, without touching history (another sheet took over). */
  forceClose: () => void
  /** System back popped the sheet's history entry. */
  onPop: () => void
}

let active: SheetHandle | null = null
let entryPushed = false
let listening = false
/** Callbacks waiting for a closed sheet's history entry to be dropped. */
let afterClose: Array<() => void> = []
/** The released sheet's `history.back()` is in flight. */
let awaitingPop = false
let fallbackTimer: ReturnType<typeof setTimeout> | null = null

/** Longest wait for the popstate of a sheet's own `history.back()` before running callbacks anyway. */
const POP_FALLBACK_MS = 500

function flushAfterClose(): void {
  awaitingPop = false
  if (fallbackTimer !== null) {
    clearTimeout(fallbackTimer)
    fallbackTimer = null
  }
  const callbacks = afterClose
  afterClose = []
  for (const callback of callbacks) callback()
}

function onPopState(): void {
  if (awaitingPop) {
    flushAfterClose()
    return
  }
  if (!active || !entryPushed) return
  entryPushed = false
  active.onPop()
}

function listen(): void {
  if (listening || typeof window === 'undefined') return
  window.addEventListener('popstate', onPopState)
  listening = true
}

function pushEntry(): void {
  if (entryPushed) return
  const state: unknown = window.history.state
  const base = state && typeof state === 'object' ? (state as Record<string, unknown>) : {}
  window.history.pushState({ ...base, sheet: true }, '')
  entryPushed = true
}

/** Register `sheet` as the open sheet. Closes any other open sheet. */
export function claimSheet(sheet: SheetHandle): void {
  listen()
  const previous = active
  active = sheet
  if (previous && previous !== sheet) previous.forceClose()
  pushEntry()
}

/** Re-push the entry after a back press that the sheet refused (unsaved input asks first). */
export function repushSheetEntry(sheet: SheetHandle): void {
  if (active === sheet) pushEntry()
}

/** The sheet closed. Drops its history entry unless another sheet claimed it meanwhile. */
export function releaseSheet(sheet: SheetHandle): void {
  if (active !== sheet) return
  active = null
  // Deferred so a sheet that reopens in the same tick (React StrictMode, sheet swaps) keeps the entry.
  setTimeout(() => {
    if (active || !entryPushed) {
      flushAfterClose()
      return
    }
    entryPushed = false
    const state: unknown = window.history.state
    const isSheetEntry =
      !!state && typeof state === 'object' && (state as Record<string, unknown>).sheet === true
    // If something navigated meanwhile, the sheet entry is no longer on top: leave history alone.
    if (!isSheetEntry) {
      flushAfterClose()
      return
    }
    if (afterClose.length > 0) {
      awaitingPop = true
      fallbackTimer = setTimeout(flushAfterClose, POP_FALLBACK_MS)
    }
    window.history.back()
  }, 0)
}

/**
 * Run `callback` once the open (or just closed) sheet's history entry is gone, e.g. a navigation
 * picked inside a sheet. Navigating first would replace the sheet's entry instead, leaving an extra
 * history step behind. With no sheet involved it runs right away.
 */
export function runAfterSheetClose(callback: () => void): void {
  if (!active && !entryPushed && !awaitingPop) {
    callback()
    return
  }
  afterClose.push(callback)
}

/** True while any sheet is open (the shell's Esc-to-Today ignores Esc then). */
export function isSheetOpen(): boolean {
  return active !== null
}
