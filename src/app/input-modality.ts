/**
 * Touch feel. Marks <html data-input="pointer|keyboard"> by the last way the member interacted, so
 * app.css hides focus rings that only appear because the app moved focus after a tap (sheets opening
 * and closing, headings after navigation); a keyboard user sees rings once they press Tab or an arrow key; until then (and after any tap) none show, text fields included.
 * Also registers an empty touchstart listener: without one, iOS Safari never applies `:active`, so the
 * pressed feedback on buttons would not show.
 */
const KEYBOARD_NAV_KEYS = new Set([
  'Tab',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Home',
  'End',
  'PageUp',
  'PageDown',
  'Escape',
])

export function startInputModality(doc: Document = document): () => void {
  const root = doc.documentElement
  const onPointer = () => {
    root.dataset.input = 'pointer'
  }
  // Typing into a field (the soft keyboard sends keys too) is not keyboard navigation.
  const onKey = (event: KeyboardEvent) => {
    if (KEYBOARD_NAV_KEYS.has(event.key)) root.dataset.input = 'keyboard'
  }
  const onTouchStart = () => {}
  doc.addEventListener('pointerdown', onPointer, { capture: true, passive: true })
  doc.addEventListener('keydown', onKey, { capture: true })
  doc.addEventListener('touchstart', onTouchStart, { passive: true })
  return () => {
    doc.removeEventListener('pointerdown', onPointer, { capture: true })
    doc.removeEventListener('keydown', onKey, { capture: true })
    doc.removeEventListener('touchstart', onTouchStart)
  }
}
