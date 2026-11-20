import { act, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  HINT_DISMISSED_AT_KEY,
  INSTALLED_KEY,
  markInstalled,
  resetInstallState,
} from '@/data/install-state'
import { renderRoutes } from '@/test/fake-backend'
import { keepFakePrompt, restoreDevice, setDevice, setStandalone, UA } from '@/test/install-env'

const BANNER = 'Reminders need Proofy on your home screen.'
const HINT = 'Proofy works best from your home screen. Full screen, one tap away.'
const DAY_MS = 86_400_000

afterEach(() => {
  resetInstallState()
  restoreDevice()
})

async function openToday() {
  const result = renderRoutes(['/today'])
  await screen.findByRole('button', { name: 'Group: Gym Rats, switch group' })
  // The focused group reaches the URL (`?g=`) in a replace navigation after the groups load; act
  // only once it is there, or "Show me how" can still carry the old, empty search.
  await vi.waitFor(() => expect(result.router.state.location.search).toBe('?g=group-1'))
  // The router state can lead React's render; flush it so click handlers see the new search.
  await act(async () => {})
  return result
}

describe('Today install notice', () => {
  it('iOS Safari tab: the persistent Banner; Show me how opens /install', async () => {
    const user = userEvent.setup()
    setDevice(UA.iphoneSafari)
    // Even a recent Not now on the Hint does not hide the Banner.
    localStorage.setItem(HINT_DISMISSED_AT_KEY, new Date().toISOString())
    const { router } = await openToday()
    expect(screen.getByText(BANNER)).toBeInTheDocument()
    expect(screen.queryByText(HINT)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Not now' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Show me how' }))
    await vi.waitFor(() => expect(router.state.location.pathname).toBe('/install'))
    expect(router.state.location.search).toBe('?g=group-1')
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Put Proofy on your home screen' }),
    ).toBeInTheDocument()
  })

  it('other platforms: the Hint; Not now hides it and stores the time', async () => {
    const user = userEvent.setup()
    setDevice(UA.android)
    await openToday()
    expect(screen.getByText(HINT)).toBeInTheDocument()
    expect(screen.queryByText(BANNER)).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Not now' }))
    expect(screen.queryByText(HINT)).not.toBeInTheDocument()
    const stored = localStorage.getItem(HINT_DISMISSED_AT_KEY)
    expect(stored).not.toBeNull()
    expect(Date.now() - Date.parse(stored ?? '')).toBeLessThan(60_000)
  })

  it('the Hint stays hidden 6 days after Not now and returns after 7', async () => {
    setDevice(UA.android)
    localStorage.setItem(HINT_DISMISSED_AT_KEY, new Date(Date.now() - 6 * DAY_MS).toISOString())
    const first = await openToday()
    expect(screen.queryByText(HINT)).not.toBeInTheDocument()
    first.unmount()

    localStorage.setItem(HINT_DISMISSED_AT_KEY, new Date(Date.now() - 7 * DAY_MS).toISOString())
    await openToday()
    expect(screen.getByText(HINT)).toBeInTheDocument()
  })

  it('a bad stored date shows the Hint', async () => {
    setDevice(UA.desktopFirefox, 0)
    localStorage.setItem(HINT_DISMISSED_AT_KEY, 'garbage')
    await openToday()
    expect(screen.getByText(HINT)).toBeInTheDocument()
  })

  it('Hint Install with a kept prompt opens the browser prompt', async () => {
    const user = userEvent.setup()
    setDevice(UA.android)
    const event = keepFakePrompt('accepted')
    const { router } = await openToday()
    await user.click(screen.getByRole('button', { name: 'Install' }))
    expect(event.prompt).toHaveBeenCalledTimes(1)
    expect(router.state.location.pathname).toBe('/today')
    // The browser then fires appinstalled.
    act(() => markInstalled())
    expect(screen.queryByText(HINT)).not.toBeInTheDocument()
  })

  it('Hint Install when the kept prompt throws opens /install', async () => {
    const user = userEvent.setup()
    setDevice(UA.android)
    keepFakePrompt('throws')
    const { router } = await openToday()
    await user.click(screen.getByRole('button', { name: 'Install' }))
    await vi.waitFor(() => expect(router.state.location.pathname).toBe('/install'))
  })

  it('Hint Install when the prompt is dismissed stays on Today with the Hint', async () => {
    const user = userEvent.setup()
    setDevice(UA.android)
    const event = keepFakePrompt('dismissed')
    const { router } = await openToday()
    await user.click(screen.getByRole('button', { name: 'Install' }))
    expect(event.prompt).toHaveBeenCalledTimes(1)
    await act(async () => {
      await event.userChoice
    })
    expect(router.state.location.pathname).toBe('/today')
    expect(screen.getByText(HINT)).toBeInTheDocument()
  })

  it('Hint Install without a prompt opens /install', async () => {
    const user = userEvent.setup()
    setDevice(UA.desktopFirefox, 0)
    const { router } = await openToday()
    await user.click(screen.getByRole('button', { name: 'Install' }))
    await vi.waitFor(() => expect(router.state.location.pathname).toBe('/install'))
  })

  it('installed (standalone or stored appinstalled): neither Banner nor Hint', async () => {
    setDevice(UA.iphoneSafari)
    setStandalone(true)
    const first = await openToday()
    expect(screen.queryByText(BANNER)).not.toBeInTheDocument()
    first.unmount()

    setStandalone(false)
    setDevice(UA.android)
    localStorage.setItem(INSTALLED_KEY, '1')
    await openToday()
    expect(screen.queryByText(HINT)).not.toBeInTheDocument()
    expect(screen.queryByText(BANNER)).not.toBeInTheDocument()
  })
})
