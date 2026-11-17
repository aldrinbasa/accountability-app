import { act, render, screen } from '@testing-library/react'
import {
  dismissInstallGuide,
  dismissInstallHint,
  getInstallState,
  GUIDE_DISMISSED_KEY,
  HINT_DISMISSED_AT_KEY,
  INSTALLED_KEY,
  markInstalled,
  promptInstall,
  resetInstallState,
  useInstallState,
} from '@/data/install-state'
import {
  keepFakePrompt,
  restoreDevice,
  setDevice,
  setNavigatorStandalone,
  setStandalone,
  UA,
} from '@/test/install-env'

afterEach(() => {
  resetInstallState()
  restoreDevice()
  vi.restoreAllMocks()
})

describe('install state', () => {
  it('a plain browser tab: not installed, nothing dismissed, no prompt', () => {
    setDevice(UA.android)
    expect(getInstallState()).toEqual({
      platform: 'other',
      installed: false,
      canPrompt: false,
      guideDismissed: false,
      hintDismissedAt: null,
    })
  })

  it('detects the platform from the user agent and touch points', () => {
    setDevice(UA.iphoneSafari)
    expect(getInstallState().platform).toBe('ios-safari')
    setDevice(UA.ipadDesktop, 5)
    expect(getInstallState().platform).toBe('ios-safari')
    setDevice(UA.iphoneChrome)
    expect(getInstallState().platform).toBe('ios-other')
    setDevice(UA.desktopFirefox, 0)
    expect(getInstallState().platform).toBe('other')
  })

  it('installed: display-mode standalone, navigator.standalone, or a stored appinstalled', () => {
    setStandalone(true)
    expect(getInstallState().installed).toBe(true)
    setStandalone(false)
    expect(getInstallState().installed).toBe(false)
    setNavigatorStandalone(true)
    expect(getInstallState().installed).toBe(true)
    setNavigatorStandalone(false)
    localStorage.setItem(INSTALLED_KEY, '1')
    expect(getInstallState().installed).toBe(true)
  })

  it('appinstalled stores the flag and drops the kept prompt', () => {
    keepFakePrompt('accepted')
    expect(getInstallState().canPrompt).toBe(true)
    markInstalled()
    expect(localStorage.getItem(INSTALLED_KEY)).toBe('1')
    expect(getInstallState()).toMatchObject({ installed: true, canPrompt: false })
  })

  it('a fired install prompt means not installed: clears an earlier appinstalled', () => {
    markInstalled()
    expect(getInstallState().installed).toBe(true)
    keepFakePrompt('accepted')
    expect(localStorage.getItem(INSTALLED_KEY)).toBeNull()
    expect(getInstallState()).toMatchObject({ installed: false, canPrompt: true })
  })

  it('stores the guide dismissal and the hint dismissed-at time', () => {
    dismissInstallGuide()
    dismissInstallHint(new Date('2026-11-17T08:00:00.000Z'))
    expect(localStorage.getItem(GUIDE_DISMISSED_KEY)).toBe('1')
    expect(localStorage.getItem(HINT_DISMISSED_AT_KEY)).toBe('2026-11-17T08:00:00.000Z')
    expect(getInstallState()).toMatchObject({
      guideDismissed: true,
      hintDismissedAt: '2026-11-17T08:00:00.000Z',
    })
  })

  it('returns the same snapshot object until something changes', () => {
    const first = getInstallState()
    expect(getInstallState()).toBe(first)
    dismissInstallGuide()
    expect(getInstallState()).not.toBe(first)
  })

  it('storage blocked: never throws, and dismissals still hold for the session', () => {
    const blocked = {
      getItem: () => {
        throw new Error('SecurityError')
      },
      setItem: () => {
        throw new Error('QuotaExceededError')
      },
    }
    const real = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: blocked })
    try {
      expect(getInstallState()).toMatchObject({ installed: false, guideDismissed: false })
      expect(() => dismissInstallGuide()).not.toThrow()
      expect(() => dismissInstallHint(new Date('2026-11-17T08:00:00.000Z'))).not.toThrow()
      expect(() => markInstalled()).not.toThrow()
      expect(getInstallState()).toMatchObject({
        installed: true,
        guideDismissed: true,
        hintDismissedAt: '2026-11-17T08:00:00.000Z',
      })
    } finally {
      if (real) Object.defineProperty(globalThis, 'localStorage', real)
    }
  })
})

describe('promptInstall', () => {
  it('without a kept prompt: unavailable', async () => {
    await expect(promptInstall()).resolves.toBe('unavailable')
  })

  it('accepted or dismissed, and the event is used only once', async () => {
    const event = keepFakePrompt('accepted')
    await expect(promptInstall()).resolves.toBe('accepted')
    expect(event.prompt).toHaveBeenCalledTimes(1)
    expect(getInstallState().canPrompt).toBe(false)
    await expect(promptInstall()).resolves.toBe('unavailable')
    expect(event.prompt).toHaveBeenCalledTimes(1)

    keepFakePrompt('dismissed')
    await expect(promptInstall()).resolves.toBe('dismissed')
  })

  it('a prompt() that throws: unavailable', async () => {
    keepFakePrompt('throws')
    await expect(promptInstall()).resolves.toBe('unavailable')
  })
})

describe('useInstallState', () => {
  function Probe() {
    const state = useInstallState()
    return (
      <p>
        {state.canPrompt ? 'prompt' : 'no prompt'} / {state.installed ? 'installed' : 'tab'}
      </p>
    )
  }

  it('re-renders when the prompt arrives and when the app installs', () => {
    render(<Probe />)
    expect(screen.getByText('no prompt / tab')).toBeInTheDocument()
    act(() => {
      keepFakePrompt('accepted')
    })
    expect(screen.getByText('prompt / tab')).toBeInTheDocument()
    act(() => markInstalled())
    expect(screen.getByText('no prompt / installed')).toBeInTheDocument()
  })
})
