import type { Mock } from 'vitest'
import { captureInstallPrompt, type DeferredInstallPrompt } from '@/data/install-state'

export const UA = {
  iphoneSafari:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1',
  ipadDesktop:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15',
  iphoneChrome:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/131.0.6778.73 Mobile/15E148 Safari/604.1',
  android:
    'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
  desktopFirefox:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0',
}

const original = {
  userAgent: Object.getOwnPropertyDescriptor(navigator, 'userAgent'),
  maxTouchPoints: Object.getOwnPropertyDescriptor(navigator, 'maxTouchPoints'),
  standalone: Object.getOwnPropertyDescriptor(navigator, 'standalone'),
}

/** Pretend to be a given browser (user agent and touch points). */
export function setDevice(userAgent: string, maxTouchPoints = 5): void {
  Object.defineProperty(navigator, 'userAgent', { configurable: true, get: () => userAgent })
  Object.defineProperty(navigator, 'maxTouchPoints', {
    configurable: true,
    get: () => maxTouchPoints,
  })
}

/** Pretend to run as the home-screen app (display-mode standalone). */
export function setStandalone(standalone: boolean): void {
  const base = window.matchMedia
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: (query: string): MediaQueryList => {
      const list = base(query)
      if (!query.includes('display-mode: standalone')) return list
      return { ...list, matches: standalone, media: query }
    },
  })
}

/** Put `navigator.standalone` (iOS Safari) in place. */
export function setNavigatorStandalone(value: boolean): void {
  Object.defineProperty(navigator, 'standalone', { configurable: true, get: () => value })
}

/** Undo every device stub (own properties shadow jsdom's prototype getters). */
export function restoreDevice(): void {
  for (const key of ['userAgent', 'maxTouchPoints', 'standalone'] as const) {
    const descriptor = original[key]
    if (descriptor) Object.defineProperty(navigator, key, descriptor)
    else Reflect.deleteProperty(navigator, key)
  }
}

export interface FakePrompt extends DeferredInstallPrompt {
  prompt: Mock<() => Promise<void>>
}

/** Keep a fake `beforeinstallprompt` event whose choice resolves to `outcome` (or whose prompt throws). */
export function keepFakePrompt(outcome: 'accepted' | 'dismissed' | 'throws'): FakePrompt {
  const event: FakePrompt = {
    prompt: vi.fn(async () => {
      if (outcome === 'throws') throw new Error('NotAllowedError')
    }),
    userChoice: Promise.resolve({ outcome: outcome === 'throws' ? 'dismissed' : outcome }),
  }
  captureInstallPrompt(event)
  return event
}
