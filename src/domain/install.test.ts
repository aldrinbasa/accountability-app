import {
  detectPlatform,
  installGuideApplies,
  installNotice,
  HINT_INTERVAL_MS,
  installGuideTarget,
  isInstalled,
  isInstallPath,
  shouldShowHint,
} from '@/domain/install'

const UA = {
  iphoneSafari:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1',
  ipadDesktop:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15',
  iphoneChrome:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/131.0.6778.73 Mobile/15E148 Safari/604.1',
  iphoneFirefox:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/133.0 Mobile/15E148 Safari/605.1.15',
  iphoneEdge:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 EdgiOS/131.0.2903.68 Mobile/15E148 Safari/605.1.15',
  ipadChromeDesktop:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/131.0.6778.73 Safari/604.1',
  android:
    'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
  macSafari:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15',
  facebookInApp:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/490.0.0.39.107;FBBV/123;FBDV/iPhone15,2;FBMD/iPhone;FBSN/iOS;FBSV/18.1;FBSS/3;FBID/phone;FBLC/en_US;FBOP/5]',
  googleApp:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) GSA/343.0.695551749 Mobile/15E148 Safari/604.1',
  windowsChrome:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
}

describe('detectPlatform', () => {
  it('iPhone Safari is ios-safari', () => {
    expect(detectPlatform(UA.iphoneSafari, 5)).toBe('ios-safari')
  })

  it('iPadOS with a desktop (Mac) user agent and touch is ios-safari', () => {
    expect(detectPlatform(UA.ipadDesktop, 5)).toBe('ios-safari')
  })

  it('iOS Chrome, Firefox and Edge are ios-other', () => {
    expect(detectPlatform(UA.iphoneChrome, 5)).toBe('ios-other')
    expect(detectPlatform(UA.iphoneFirefox, 5)).toBe('ios-other')
    expect(detectPlatform(UA.iphoneEdge, 5)).toBe('ios-other')
    expect(detectPlatform(UA.ipadChromeDesktop, 5)).toBe('ios-other')
  })

  it('iOS in-app browsers are ios-other: Facebook (no Safari/) and the Google app (GSA/)', () => {
    expect(detectPlatform(UA.facebookInApp, 5)).toBe('ios-other')
    expect(detectPlatform(UA.googleApp, 5)).toBe('ios-other')
  })

  it('Android is other (prompt or browser menu)', () => {
    expect(detectPlatform(UA.android, 5)).toBe('other')
  })

  it('desktop browsers are other, including a Mac without touch', () => {
    expect(detectPlatform(UA.macSafari, 0)).toBe('other')
    expect(detectPlatform(UA.macSafari, 1)).toBe('other')
    expect(detectPlatform(UA.windowsChrome, 0)).toBe('other')
  })
})

describe('isInstalled', () => {
  const none = { standalone: false, navigatorStandalone: false, storedInstalled: false }

  it('is false in a plain browser tab', () => {
    expect(isInstalled(none)).toBe(false)
  })

  it('is true for display-mode standalone, navigator.standalone, or a stored appinstalled', () => {
    expect(isInstalled({ ...none, standalone: true })).toBe(true)
    expect(isInstalled({ ...none, navigatorStandalone: true })).toBe(true)
    expect(isInstalled({ ...none, storedInstalled: true })).toBe(true)
  })
})

describe('shouldShowHint', () => {
  const now = new Date('2026-11-17T12:00:00.000Z')
  const daysAgo = (days: number) => new Date(now.getTime() - days * 86_400_000).toISOString()

  it('shows when never dismissed', () => {
    expect(shouldShowHint(null, now)).toBe(true)
  })

  it('stays hidden 6 days after Not now, returns at 7', () => {
    expect(shouldShowHint(daysAgo(6), now)).toBe(false)
    expect(shouldShowHint(new Date(now.getTime() - HINT_INTERVAL_MS + 1).toISOString(), now)).toBe(
      false,
    )
    expect(shouldShowHint(daysAgo(7), now)).toBe(true)
    expect(shouldShowHint(daysAgo(30), now)).toBe(true)
  })

  it('shows when the stored date is unreadable or in the future', () => {
    expect(shouldShowHint('not a date', now)).toBe(true)
    expect(shouldShowHint('', now)).toBe(true)
    expect(shouldShowHint(daysAgo(-2), now)).toBe(true)
  })
})

describe('installGuideTarget', () => {
  it('forwards to the pending next path', () => {
    expect(installGuideTarget('/board?g=x')).toBe('/board?g=x')
  })

  it('falls back to /today with no next or an unsafe one', () => {
    expect(installGuideTarget(null)).toBe('/today')
    expect(installGuideTarget('https://evil.example')).toBe('/today')
    expect(installGuideTarget('//evil.example')).toBe('/today')
  })

  it('ignores a next that points back at the guide', () => {
    expect(installGuideTarget('/install')).toBe('/today')
    expect(installGuideTarget('/install/')).toBe('/today')
    expect(installGuideTarget('/install?g=1')).toBe('/today')
    expect(installGuideTarget('/INSTALL')).toBe('/today')
    expect(installGuideTarget('/Install//?g=1')).toBe('/today')
  })
})

describe('isInstallPath', () => {
  it('matches like the router: any case, trailing slashes ignored', () => {
    for (const path of ['/install', '/install/', '/INSTALL', '/Install//']) {
      expect(isInstallPath(path)).toBe(true)
    }
    for (const path of ['/installer', '/today', '/', '/setup']) {
      expect(isInstallPath(path)).toBe(false)
    }
  })
})

describe('installNotice', () => {
  const now = new Date('2026-11-17T12:00:00.000Z')
  const base = { installed: false, hintDismissedAt: null }

  it('iOS Safari tab: the Banner, even after a recent Not now', () => {
    expect(installNotice({ ...base, platform: 'ios-safari' }, now)).toBe('banner')
    expect(
      installNotice(
        { platform: 'ios-safari', installed: false, hintDismissedAt: now.toISOString() },
        now,
      ),
    ).toBe('banner')
  })

  it('other platforms: the Hint, hidden for a week after Not now', () => {
    expect(installNotice({ ...base, platform: 'other' }, now)).toBe('hint')
    expect(installNotice({ ...base, platform: 'ios-other' }, now)).toBe('hint')
    expect(
      installNotice(
        { platform: 'other', installed: false, hintDismissedAt: '2026-11-15T12:00:00.000Z' },
        now,
      ),
    ).toBeNull()
  })

  it('installed: nothing anywhere', () => {
    for (const platform of ['ios-safari', 'ios-other', 'other'] as const) {
      expect(installNotice({ platform, installed: true, hintDismissedAt: null }, now)).toBeNull()
    }
  })
})

describe('installGuideApplies', () => {
  it('only when not installed and not dismissed', () => {
    expect(installGuideApplies({ installed: false, guideDismissed: false })).toBe(true)
    expect(installGuideApplies({ installed: true, guideDismissed: false })).toBe(false)
    expect(installGuideApplies({ installed: false, guideDismissed: true })).toBe(false)
  })
})
