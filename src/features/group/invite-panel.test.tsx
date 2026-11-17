import { act, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BackendError } from '@/domain/error-codes'
import { inviteExpiryText, type MyGroup } from '@/domain/groups'
import { createFakeBackend, renderRoutes, TEST_GROUP, TEST_INVITE } from '@/test/fake-backend'

const toast = vi.hoisted(() => ({ showToast: vi.fn(), dismissToast: vi.fn() }))
vi.mock('@/ui/toast', () => toast)

const WAITING: MyGroup = { ...TEST_GROUP, memberCount: 1 }
const ORIGIN = window.location.origin

function setShare(share: ((data: ShareData) => Promise<void>) | undefined) {
  Object.defineProperty(navigator, 'share', { configurable: true, writable: true, value: share })
}

function setClipboard(writeText: ((text: string) => Promise<void>) | undefined) {
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    writable: true,
    value: writeText ? { writeText } : undefined,
  })
}

async function findPanel() {
  return screen.findByRole('region', { name: 'Invite friends' })
}

beforeEach(() => {
  toast.showToast.mockClear()
  setShare(undefined)
  setClipboard(vi.fn(async () => {}))
})

afterEach(() => {
  vi.useRealTimers()
})

describe('Invite panel', () => {
  it('on the waiting Today: the admin gets the code, expiry, Share link and Copy code', async () => {
    const backend = createFakeBackend(undefined, { groups: [WAITING] })
    renderRoutes(['/today?g=group-1'], backend)
    const panel = await findPanel()
    expect(screen.getByText('Just you in here so far.')).toBeInTheDocument()
    expect(await within(panel).findByText('K7QX2M')).toBeInTheDocument()
    expect(within(panel).getByText('Invite code K 7 Q X 2 M')).toBeInTheDocument()
    expect(within(panel).getByText('Link or code · up to 10 people')).toBeInTheDocument()
    expect(within(panel).getByText(inviteExpiryText(TEST_INVITE.expiresAt))).toBeInTheDocument()
    expect(within(panel).getByRole('button', { name: 'Share link' })).toBeInTheDocument()
    expect(within(panel).getByRole('button', { name: 'Copy code' })).toBeInTheDocument()
    expect(backend.createInvite).toHaveBeenCalledWith('group-1', false)
  })

  it('in group settings for the admin', async () => {
    renderRoutes(['/me/groups/group-1?g=group-1'])
    const panel = await findPanel()
    expect(await within(panel).findByText('K7QX2M')).toBeInTheDocument()
  })

  it('members who are not admin see no panel and nothing is asked of the server', async () => {
    const backend = createFakeBackend(undefined, { groups: [{ ...WAITING, role: 'member' }] })
    const today = renderRoutes(['/today?g=group-1'], backend)
    await screen.findByText('Just you in here so far.')
    expect(screen.queryByRole('region', { name: 'Invite friends' })).not.toBeInTheDocument()
    today.unmount()
    renderRoutes(['/me/groups/group-1'], backend)
    await screen.findByText('Group time zone')
    expect(screen.queryByRole('region', { name: 'Invite friends' })).not.toBeInTheDocument()
    expect(backend.createInvite).not.toHaveBeenCalled()
  })

  it('a full group shows "Group\'s full. 10 is the max." without calling create_invite', async () => {
    const backend = createFakeBackend(undefined, { groups: [{ ...TEST_GROUP, memberCount: 10 }] })
    renderRoutes(['/me/groups/group-1'], backend)
    const panel = await findPanel()
    expect(within(panel).getByText("Group's full. 10 is the max.")).toBeInTheDocument()
    expect(within(panel).queryByRole('button')).not.toBeInTheDocument()
    expect(backend.createInvite).not.toHaveBeenCalled()
  })

  it('Share link opens the OS share sheet with {origin}/join/{code}', async () => {
    const user = userEvent.setup()
    const share = vi.fn(async () => {})
    setShare(share)
    renderRoutes(['/me/groups/group-1'])
    const panel = await findPanel()
    await user.click(await within(panel).findByRole('button', { name: 'Share link' }))
    expect(share).toHaveBeenCalledWith({ url: `${ORIGIN}/join/K7QX2M` })
    expect(toast.showToast).not.toHaveBeenCalled()
  })

  it('a cancelled share (AbortError) does nothing', async () => {
    const user = userEvent.setup()
    const writeText = vi.fn(async () => {})
    setClipboard(writeText)
    setShare(vi.fn(async () => Promise.reject(new DOMException('cancelled', 'AbortError'))))
    renderRoutes(['/me/groups/group-1'])
    const panel = await findPanel()
    await user.click(await within(panel).findByRole('button', { name: 'Share link' }))
    expect(writeText).not.toHaveBeenCalled()
    expect(toast.showToast).not.toHaveBeenCalled()
  })

  it('without Web Share, Share link copies the link and says "Link copied."', async () => {
    const user = userEvent.setup()
    const writeText = vi.fn(async () => {})
    setClipboard(writeText)
    renderRoutes(['/me/groups/group-1'])
    const panel = await findPanel()
    await user.click(await within(panel).findByRole('button', { name: 'Share link' }))
    expect(writeText).toHaveBeenCalledWith(`${ORIGIN}/join/K7QX2M`)
    expect(toast.showToast).toHaveBeenCalledWith('Link copied.')
  })

  it('Copy code copies the code and says "Code copied."; a refused clipboard names the code', async () => {
    const user = userEvent.setup()
    const writeText = vi.fn(async () => {})
    setClipboard(writeText)
    renderRoutes(['/me/groups/group-1'])
    const panel = await findPanel()
    await user.click(await within(panel).findByRole('button', { name: 'Copy code' }))
    expect(writeText).toHaveBeenCalledWith('K7QX2M')
    expect(toast.showToast).toHaveBeenCalledWith('Code copied.')

    writeText.mockRejectedValueOnce(new DOMException('denied', 'NotAllowedError'))
    await user.click(within(panel).getByRole('button', { name: 'Copy code' }))
    expect(toast.showToast).toHaveBeenLastCalledWith("Couldn't copy. The code is K7QX2M.", {
      variant: 'error',
    })
  })

  it('an expired invite is struck through; "Make a new one" calls create_invite(g, true)', async () => {
    const user = userEvent.setup()
    const backend = createFakeBackend()
    vi.mocked(backend.createInvite).mockResolvedValueOnce({
      code: 'OLDCDE',
      expiresAt: '2020-01-01T00:00:00.000Z',
    })
    renderRoutes(['/me/groups/group-1'], backend)
    const panel = await findPanel()
    expect(await within(panel).findByText('This invite expired. Make a new one.')).toBeVisible()
    expect(within(panel).getByText('OLDCDE').tagName).toBe('S')
    expect(within(panel).queryByRole('button', { name: 'Share link' })).not.toBeInTheDocument()

    await user.click(within(panel).getByRole('button', { name: 'Make a new one' }))
    expect(backend.createInvite).toHaveBeenLastCalledWith('group-1', true)
    expect(await within(panel).findByText('NEW1AB')).toBeInTheDocument()
    expect(within(panel).getByRole('button', { name: 'Share link' })).toBeInTheDocument()
  })

  it('a failed "Make a new one" shows an Inline retry in the panel', async () => {
    const user = userEvent.setup()
    const backend = createFakeBackend()
    vi.mocked(backend.createInvite)
      .mockResolvedValueOnce({ code: 'OLDCDE', expiresAt: '2020-01-01T00:00:00.000Z' })
      .mockRejectedValueOnce(new BackendError('network'))
    renderRoutes(['/me/groups/group-1'], backend)
    const panel = await findPanel()
    await user.click(await within(panel).findByRole('button', { name: 'Make a new one' }))
    expect(await within(panel).findByRole('alert')).toHaveTextContent(
      "Couldn't make a new invite. Check your signal and tap Retry.",
    )
    await user.click(within(panel).getByRole('button', { name: 'Retry' }))
    expect(await within(panel).findByText('NEW1AB')).toBeInTheDocument()
  })

  it('turns expired in place when expires_at passes while shown', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.setSystemTime(Date.parse(TEST_INVITE.expiresAt) - 5_000)
    renderRoutes(['/me/groups/group-1'])
    const panel = await findPanel()
    expect(await within(panel).findByRole('button', { name: 'Share link' })).toBeInTheDocument()
    await act(async () => {
      vi.advanceTimersByTime(6_000)
    })
    expect(within(panel).getByText('This invite expired. Make a new one.')).toBeInTheDocument()
    expect(within(panel).getByText('K7QX2M').tagName).toBe('S')
  })

  it('a load failure shows an Inline retry in the panel', async () => {
    const user = userEvent.setup()
    const backend = createFakeBackend()
    vi.mocked(backend.createInvite).mockRejectedValue(new BackendError('network'))
    renderRoutes(['/me/groups/group-1'], backend)
    const panel = await findPanel()
    expect(await within(panel).findByRole('alert', {}, { timeout: 3000 })).toHaveTextContent(
      "Couldn't load the invite. Check your signal and tap Retry.",
    )
    vi.mocked(backend.createInvite).mockResolvedValue(TEST_INVITE)
    await user.click(within(panel).getByRole('button', { name: 'Retry' }))
    expect(await within(panel).findByText('K7QX2M')).toBeInTheDocument()
  })
})
