import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { App } from '@/app/app'

const sw = vi.hoisted(() => ({ needRefresh: false, updateServiceWorker: vi.fn() }))

vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW: () => ({
    needRefresh: [sw.needRefresh, vi.fn()],
    offlineReady: [false, vi.fn()],
    updateServiceWorker: sw.updateServiceWorker,
  }),
}))

describe('App', () => {
  beforeEach(() => {
    // Only Date is faked (fixed to Friday noon), so render and assertion agree across midnight.
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 10, 20, 12, 0, 0))
    sw.needRefresh = false
    sw.updateServiceWorker.mockClear()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('opens Today inside the shell, headed by the day name', async () => {
    render(<App />)
    expect(await screen.findByRole('heading', { level: 1, name: 'Friday' })).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: 'Main' })).toBeInTheDocument()
  })

  it('shows "Update ready." for a waiting worker; Update activates it', async () => {
    sw.needRefresh = true
    const user = userEvent.setup()
    render(<App />)
    expect(await screen.findByText('Update ready.')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Update' }))
    expect(sw.updateServiceWorker).toHaveBeenCalledWith(true)
  })
})
