import { act, renderHook } from '@testing-library/react'
import { setCameraOpen, setUploadRunning } from '@/ui/update-guard'
import { UPDATE_TOAST_ID, useUpdateToast } from '@/app/use-update-toast'

const toast = vi.hoisted(() => ({ showToast: vi.fn(), dismissToast: vi.fn() }))
vi.mock('@/ui/toast', () => toast)

describe('useUpdateToast', () => {
  beforeEach(() => {
    toast.showToast.mockClear()
    toast.dismissToast.mockClear()
  })
  afterEach(() => {
    act(() => {
      setCameraOpen(false)
      setUploadRunning(false)
    })
  })

  it('does nothing while no new worker is waiting', () => {
    renderHook(() => useUpdateToast(false, vi.fn()))
    expect(toast.showToast).not.toHaveBeenCalled()
  })

  it('raises "Update ready." with an Update action that activates the new worker', () => {
    const update = vi.fn()
    renderHook(() => useUpdateToast(true, update))
    expect(toast.showToast).toHaveBeenCalledTimes(1)
    const [message, options] = toast.showToast.mock.calls[0]
    expect(message).toBe('Update ready.')
    expect(options.id).toBe(UPDATE_TOAST_ID)
    expect(options.action.label).toBe('Update')
    options.action.onClick()
    expect(update).toHaveBeenCalledTimes(1)
  })

  it('waits while the guard blocks it, then raises once the guard clears', () => {
    act(() => setCameraOpen(true))
    renderHook(() => useUpdateToast(true, vi.fn()))
    expect(toast.showToast).not.toHaveBeenCalled()

    act(() => setCameraOpen(false))
    expect(toast.showToast).toHaveBeenCalledTimes(1)
  })

  it('takes the toast down when an upload starts', () => {
    renderHook(() => useUpdateToast(true, vi.fn()))
    act(() => setUploadRunning(true))
    expect(toast.dismissToast).toHaveBeenCalledWith(UPDATE_TOAST_ID)
  })
})
