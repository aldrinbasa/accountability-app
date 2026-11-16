import {
  canShowUpdatePrompt,
  setCameraOpen,
  setUploadRunning,
  subscribeUpdateGuard,
} from '@/ui/update-guard'

describe('update guard', () => {
  afterEach(() => {
    setCameraOpen(false)
    setUploadRunning(false)
  })

  it('allows the update prompt when nothing blocks it', () => {
    expect(canShowUpdatePrompt()).toBe(true)
  })

  it('blocks while the camera is open or an upload runs, and clears after both end', () => {
    setCameraOpen(true)
    expect(canShowUpdatePrompt()).toBe(false)
    setUploadRunning(true)
    setCameraOpen(false)
    expect(canShowUpdatePrompt()).toBe(false)
    setUploadRunning(false)
    expect(canShowUpdatePrompt()).toBe(true)
  })

  it('notifies subscribers on each change and stops after unsubscribe', () => {
    const listener = vi.fn()
    const unsubscribe = subscribeUpdateGuard(listener)
    setCameraOpen(true)
    setCameraOpen(true) // no change, no call
    setCameraOpen(false)
    expect(listener).toHaveBeenCalledTimes(2)
    unsubscribe()
    setUploadRunning(true)
    expect(listener).toHaveBeenCalledTimes(2)
  })
})
