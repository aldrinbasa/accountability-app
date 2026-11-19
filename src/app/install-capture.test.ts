import { getInstallState, INSTALLED_KEY, resetInstallState } from '@/data/install-state'
import { startInstallCapture } from '@/app/install-capture'

afterEach(() => resetInstallState())

describe('startInstallCapture', () => {
  it('keeps beforeinstallprompt (default prevented) and marks appinstalled', () => {
    const stop = startInstallCapture()
    const event = new Event('beforeinstallprompt', { cancelable: true })
    window.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
    expect(getInstallState().canPrompt).toBe(true)

    window.dispatchEvent(new Event('appinstalled'))
    expect(localStorage.getItem(INSTALLED_KEY)).toBe('1')
    expect(getInstallState()).toMatchObject({ installed: true, canPrompt: false })
    stop()
  })
})
