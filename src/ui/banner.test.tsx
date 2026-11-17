import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BellRinging } from '@phosphor-icons/react'
import { Banner } from '@/ui/banner'

describe('Banner', () => {
  it('is an inverted ink strip with card text and a sticky button on object', async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()
    const { container } = render(
      <Banner icon={BellRinging} action={{ label: 'Show me how', onClick }}>
        Reminders need Proofy on your home screen.
      </Banner>,
    )
    const strip = container.querySelector('[data-component="banner"]')
    // Announced to screen readers.
    expect(screen.getByRole('status')).toBe(strip)
    expect(strip).toHaveClass('bg-ink', 'text-card', 'rounded-wob-sm', 'type-body-sm')
    expect(screen.getByText('Reminders need Proofy on your home screen.')).toBeInTheDocument()
    // The icon is decorative, with the sticky soft tone.
    const icon = container.querySelector('svg')
    expect(icon).toHaveAttribute('aria-hidden', 'true')
    expect(icon?.getAttribute('style')).toContain('--sticky')

    const action = screen.getByRole('button', { name: 'Show me how' })
    expect(action).toHaveClass('on-object', 'bg-sticky', 'min-h-target-min', 'shadow-none!')
    await user.click(action)
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('has no dismiss control of its own', () => {
    render(<Banner icon={BellRinging}>Offline.</Banner>)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})
