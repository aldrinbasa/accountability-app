import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Sun, X } from '@phosphor-icons/react'
import { Button } from '@/ui/button'
import { EmptyState } from '@/ui/empty-state'
import { Icon } from '@/ui/icon'
import { IconButton } from '@/ui/icon-button'
import { InlineRetry } from '@/ui/inline-retry'
import { RoleChip } from '@/ui/role-chip'
import { Skeleton, SkeletonBlock, SKELETON_DELAY_MS } from '@/ui/skeleton'

describe('Button', () => {
  it('shows the busy label and ignores taps while busy, without a disabled state', async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()
    const { rerender } = render(
      <Button busy busyLabel="Saving…" onClick={onClick}>
        Save
      </Button>,
    )
    const button = screen.getByRole('button', { name: 'Saving…' })
    expect(button).not.toBeDisabled()
    expect(button).toHaveAttribute('aria-busy', 'true')
    await user.click(button)
    await user.click(button)
    expect(onClick).not.toHaveBeenCalled()

    rerender(
      <Button busyLabel="Saving…" onClick={onClick}>
        Save
      </Button>,
    )
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(onClick).toHaveBeenCalledTimes(1)
  })
})

describe('Icon and IconButton', () => {
  it('hides decorative icons and names labelled ones', () => {
    const { container } = render(
      <>
        <Icon icon={Sun} />
        <Icon icon={Sun} label="Sunny" />
      </>,
    )
    const svgs = container.querySelectorAll('svg')
    expect(svgs[0]).toHaveAttribute('aria-hidden', 'true')
    expect(screen.getByRole('img', { name: 'Sunny' })).toBeInTheDocument()
  })

  it('gives the icon button its accessible name', () => {
    render(<IconButton icon={X} label="Close" />)
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument()
  })
})

describe('Skeleton', () => {
  it('appears only after 300 ms: a busy wrapper plus a separate status that says "Loading"', () => {
    vi.useFakeTimers()
    try {
      const { container } = render(
        <Skeleton>
          <SkeletonBlock />
        </Skeleton>,
      )
      expect(screen.queryByRole('status')).not.toBeInTheDocument()
      act(() => {
        vi.advanceTimersByTime(SKELETON_DELAY_MS)
      })
      const status = screen.getByRole('status')
      expect(status).toHaveTextContent('Loading')
      expect(status).not.toHaveAttribute('aria-busy')
      expect(container.firstElementChild).toHaveAttribute('aria-busy', 'true')
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('InlineRetry', () => {
  it('announces the cause and fix and retries from its link', async () => {
    const user = userEvent.setup()
    const onRetry = vi.fn()
    render(<InlineRetry onRetry={onRetry}>You're offline.</InlineRetry>)
    expect(screen.getByRole('alert')).toHaveTextContent("You're offline.")
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })
})

describe('EmptyState', () => {
  it('shows the line, the meaning sentence and one action', async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()
    render(
      <EmptyState
        icon={Sun}
        line="Nothing yet."
        body="It fills up soon."
        action={{ label: 'Go', onClick }}
      />,
    )
    expect(screen.getByText('Nothing yet.')).toBeInTheDocument()
    expect(screen.getByText('It fills up soon.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Go' }))
    expect(onClick).toHaveBeenCalledTimes(1)
  })
})

describe('RoleChip', () => {
  it('draws admin on vote and member on card', () => {
    render(
      <>
        <RoleChip variant="admin">Admin</RoleChip>
        <RoleChip variant="member">Member</RoleChip>
      </>,
    )
    expect(screen.getByText('Admin')).toHaveClass('bg-vote', 'text-obj-ink')
    expect(screen.getByText('Member')).toHaveClass('bg-card', 'text-ink')
  })
})
