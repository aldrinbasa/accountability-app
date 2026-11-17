import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  GUIDE_DISMISSED_KEY,
  INSTALLED_KEY,
  markInstalled,
  resetInstallState,
} from '@/data/install-state'
import { NEXT_KEY } from '@/data/pending-signin'
import { createFakeBackend, renderRoutes, TEST_USER } from '@/test/fake-backend'
import { keepFakePrompt, restoreDevice, setDevice, UA } from '@/test/install-env'
import { dismissToast } from '@/ui/toast'
import { Toaster } from '@/ui/toaster'

const HEADING = 'Put Proofy on your home screen'
const SAFARI_HEADING = 'Open this in Safari to install'
const SETUP_HEADING = 'What do your friends call you?'

afterEach(() => {
  dismissToast()
  resetInstallState()
  restoreDevice()
  Reflect.deleteProperty(navigator, 'clipboard')
  vi.restoreAllMocks()
})

async function openGuide(heading = HEADING, backend = createFakeBackend()) {
  render(<Toaster />)
  const result = renderRoutes(['/install'], backend)
  await screen.findByRole('heading', { level: 1, name: heading })
  return result
}

function stepTitles() {
  return within(screen.getByRole('list'))
    .getAllByRole('listitem')
    .map((item) => item.querySelector('.type-body-strong')?.textContent)
}

function setClipboard(writeText: () => Promise<void>) {
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
}

describe('InstallScreen', () => {
  it('iOS Safari: three step cards with 32px icons and "Reminders need this."', async () => {
    setDevice(UA.iphoneSafari)
    await openGuide()
    expect(screen.getByText('It opens full screen, like a real app.')).toBeInTheDocument()
    expect(screen.getByText('Reminders need this.')).toHaveClass('type-hand-md', 'bg-sticky')
    expect(stepTitles()).toEqual([
      'Tap Share',
      'Tap Add to Home Screen',
      'Open Proofy from your home screen',
    ])
    expect(screen.getByText("On newer iPhones it's inside the ••• menu.")).toBeInTheDocument()
    expect(screen.getByText("Sign in there once more. It's a separate app.")).toBeInTheDocument()
    for (const item of screen.getAllByRole('listitem')) {
      expect(item).toHaveClass('card')
      expect(item.querySelector('svg')).toHaveAttribute('width', '32')
      expect(item.querySelector('.type-numeral-md')).not.toBeNull()
    }
    expect(screen.queryByRole('button', { name: 'Install Proofy' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Continue without installing' })).toHaveClass(
      'border-dashed',
    )
    // Full screen: no shell nav.
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
  })

  it('iPadOS reporting a Mac user agent with touch: the iOS Safari steps', async () => {
    setDevice(UA.ipadDesktop, 5)
    await openGuide()
    expect(stepTitles()[0]).toBe('Tap Share')
    expect(screen.getByText('Reminders need this.')).toBeInTheDocument()
  })

  it('iOS Chrome: "Open this in Safari to install" and Copy link copies the guide link', async () => {
    const user = userEvent.setup()
    setDevice(UA.iphoneChrome)
    const writeText = vi.fn(async () => {})
    await openGuide(SAFARI_HEADING)
    // After userEvent.setup(), which installs its own clipboard stub.
    setClipboard(writeText)
    expect(
      screen.getByText(
        'On iPhone, only Safari can put Proofy on your home screen. Copy the link, paste it in Safari, and the steps show there.',
      ),
    ).toBeInTheDocument()
    expect(screen.getByText('Reminders need this.')).toBeInTheDocument()
    expect(screen.queryByRole('list')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Copy link' }))
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/install`)
    expect(await screen.findByText('Link copied.')).toBeInTheDocument()
  })

  it('iOS Chrome: a failed copy shows the link in the toast', async () => {
    const user = userEvent.setup()
    setDevice(UA.iphoneChrome)
    await openGuide(SAFARI_HEADING)
    setClipboard(async () => {
      throw new Error('denied')
    })
    await user.click(screen.getByRole('button', { name: 'Copy link' }))
    expect(
      await screen.findByText(`Couldn't copy. The link is ${window.location.origin}/install.`),
    ).toBeInTheDocument()
  })

  it('Android with a kept prompt: one coral Install Proofy button; accept moves on', async () => {
    const user = userEvent.setup()
    setDevice(UA.android)
    sessionStorage.setItem(NEXT_KEY, '/feed?g=1')
    const event = keepFakePrompt('accepted')
    const { router } = await openGuide()
    expect(
      screen.getByText('It opens full screen, like a real app, and you can find it in one tap.'),
    ).toBeInTheDocument()
    expect(screen.queryByText('Reminders need this.')).not.toBeInTheDocument()
    const install = screen.getByRole('button', { name: 'Install Proofy' })
    expect(install).toHaveClass('bg-primary')

    await user.click(install)
    expect(event.prompt).toHaveBeenCalledTimes(1)
    await vi.waitFor(() => expect(router.state.location.pathname).toBe('/feed'))
    expect(router.state.location.search).toBe('?g=1')
    expect(sessionStorage.getItem(NEXT_KEY)).toBeNull()
  })

  it('Android with a kept prompt: dismissing it stays on the guide', async () => {
    const user = userEvent.setup()
    setDevice(UA.android)
    keepFakePrompt('dismissed')
    const { router } = await openGuide()
    await user.click(screen.getByRole('button', { name: 'Install Proofy' }))
    // The prompt is single-use, so the menu steps take over.
    await screen.findByText('Open your browser menu')
    expect(router.state.location.pathname).toBe('/install')
    expect(screen.getByRole('heading', { level: 1, name: HEADING })).toBeInTheDocument()
  })

  it('a prompt() that throws falls back to the browser-menu steps', async () => {
    const user = userEvent.setup()
    setDevice(UA.android)
    keepFakePrompt('throws')
    const { router } = await openGuide()
    await user.click(screen.getByRole('button', { name: 'Install Proofy' }))
    expect(await screen.findByText('Open your browser menu')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Install Proofy' })).not.toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/install')
  })

  it('no prompt (Android or desktop): the browser-menu steps', async () => {
    for (const [ua, touch] of [
      [UA.android, 5],
      [UA.desktopFirefox, 0],
    ] as const) {
      setDevice(ua, touch)
      const { unmount } = await openGuide()
      expect(stepTitles()).toEqual([
        'Open your browser menu',
        'Tap Install app or Add to Home screen',
        'Open Proofy from your home screen',
      ])
      expect(screen.getByText('Usually ⋮ or ☰ next to the address bar.')).toBeInTheDocument()
      expect(screen.getByText("That's the full-screen app.")).toBeInTheDocument()
      expect(screen.queryByText('Reminders need this.')).not.toBeInTheDocument()
      unmount()
    }
  })

  it('Continue without installing stores the dismissal and goes to the pending next', async () => {
    const user = userEvent.setup()
    setDevice(UA.iphoneSafari)
    sessionStorage.setItem(NEXT_KEY, '/me?g=abc')
    const { router } = await openGuide()
    await user.click(screen.getByRole('button', { name: 'Continue without installing' }))
    await vi.waitFor(() => expect(router.state.location.pathname).toBe('/me'))
    expect(localStorage.getItem(GUIDE_DISMISSED_KEY)).toBe('1')
    expect(sessionStorage.getItem(NEXT_KEY)).toBeNull()
  })

  it('Continue with no pending next (or next = /install) goes to /today', async () => {
    const user = userEvent.setup()
    for (const next of [null, '/install']) {
      if (next) sessionStorage.setItem(NEXT_KEY, next)
      const { router, unmount } = await openGuide()
      await user.click(screen.getByRole('button', { name: 'Continue without installing' }))
      await vi.waitFor(() => expect(router.state.location.pathname).toBe('/today'))
      unmount()
    }
  })

  it('a new member: the guide shows before Setup, and Continue keeps next for after Setup', async () => {
    const user = userEvent.setup()
    sessionStorage.setItem(NEXT_KEY, '/board?g=x')
    const backend = createFakeBackend(TEST_USER, { profile: null })
    const { router } = await openGuide(HEADING, backend)
    await user.click(screen.getByRole('button', { name: 'Continue without installing' }))
    await screen.findByRole('heading', { level: 1, name: SETUP_HEADING })
    expect(router.state.location.pathname).toBe('/setup')
    expect(sessionStorage.getItem(NEXT_KEY)).toBe('/board?g=x')
  })

  it('already installed: /install redirects to the pending next, or /today', async () => {
    localStorage.setItem(INSTALLED_KEY, '1')
    sessionStorage.setItem(NEXT_KEY, '/board?g=x')
    const first = renderRoutes(['/install'])
    await vi.waitFor(() => expect(first.router.state.location.pathname).toBe('/board'))
    expect(screen.queryByRole('heading', { name: HEADING })).not.toBeInTheDocument()
    first.unmount()

    const second = renderRoutes(['/install'])
    await vi.waitFor(() => expect(second.router.state.location.pathname).toBe('/today'))
  })

  it('installing while the guide shows (appinstalled) moves on', async () => {
    const { router } = await openGuide()
    act(() => markInstalled())
    await vi.waitFor(() => expect(router.state.location.pathname).toBe('/today'))
  })
})
