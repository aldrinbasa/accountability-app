import { act, fireEvent, render, screen } from '@testing-library/react'
import { dismissToast, showToast } from '@/ui/toast'
import { Toaster } from '@/ui/toaster'

/** Sonner hands new toasts to the Toaster on a timer tick. */
function raise(...args: Parameters<typeof showToast>) {
  act(() => {
    showToast(...args)
    vi.advanceTimersByTime(0)
  })
}

describe('Toast', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    act(() => {
      dismissToast()
      vi.runOnlyPendingTimers()
    })
    vi.useRealTimers()
  })

  it('keeps a persistent toast past 5 s; its action runs and removes the slip', () => {
    const onUpdate = vi.fn()
    render(<Toaster />)

    raise('Update ready.', { persistent: true, action: { label: 'Update', onClick: onUpdate } })
    expect(screen.getByText('Update ready.')).toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(6000)
    })
    expect(screen.getByText('Update ready.')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Update' }))
    expect(onUpdate).toHaveBeenCalledTimes(1)
    // Dismissal reaches the Toaster on a tick, then the slip unmounts after sonner's exit delay.
    for (let tick = 0; tick < 3; tick++) {
      act(() => {
        vi.advanceTimersByTime(500)
      })
    }
    expect(screen.queryByText('Update ready.')).not.toBeInTheDocument()
  })

  it('removes a plain toast after 4 s', () => {
    render(<Toaster />)
    raise('Code copied.')
    expect(screen.getByText('Code copied.')).toBeInTheDocument()
    act(() => {
      vi.advanceTimersByTime(5000)
    })
    expect(screen.queryByText('Code copied.')).not.toBeInTheDocument()
  })
})
