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

function onPopState(): void {
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
    if (active || !entryPushed) return
    entryPushed = false
    const state: unknown = window.history.state
    const isSheetEntry =
      !!state && typeof state === 'object' && (state as Record<string, unknown>).sheet === true
    // If something navigated meanwhile, the sheet entry is no longer on top: leave history alone.
    if (isSheetEntry) window.history.back()
  }, 0)
}

/** True while any sheet is open (the shell's Esc-to-Today ignores Esc then). */
export function isSheetOpen(): boolean {
  return active !== null
}
