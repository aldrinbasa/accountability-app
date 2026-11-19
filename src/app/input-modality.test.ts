import { startInputModality } from '@/app/input-modality'

afterEach(() => {
  delete document.documentElement.dataset.input
})

describe('input modality', () => {
  it('marks a tap as pointer and Tab or arrows as keyboard, but not typing', () => {
    const stop = startInputModality()
    const root = document.documentElement
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    expect(root.dataset.input).toBe('pointer')
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }))
    expect(root.dataset.input).toBe('pointer')
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }))
    expect(root.dataset.input).toBe('keyboard')
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    expect(root.dataset.input).toBe('pointer')
    stop()
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }))
    expect(root.dataset.input).toBe('pointer')
  })
})
