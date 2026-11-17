import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DeviceMobile } from '@phosphor-icons/react'
import { Hint } from '@/ui/hint'

describe('Hint', () => {
  it('is a dashed muted box with body-sm text, an icon and 44px text-link actions', async () => {
    const user = userEvent.setup()
    const onInstall = vi.fn()
    const onNotNow = vi.fn()
    const { container } = render(
      <Hint
        icon={DeviceMobile}
        actions={[
          { label: 'Install', onClick: onInstall },
          { label: 'Not now', onClick: onNotNow },
        ]}
      >
        Proofy works best from your home screen.
      </Hint>,
    )
    const box = container.querySelector('[data-component="hint"]')
    expect(box).toHaveClass('border-dashed', 'border-muted', 'text-muted', 'type-body-sm')
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')

    const notNow = screen.getByRole('button', { name: 'Not now' })
    // Each action is described by the message.
    for (const name of ['Install', 'Not now']) {
      expect(screen.getByRole('button', { name })).toHaveAccessibleDescription(
        'Proofy works best from your home screen.',
      )
    }
    expect(notNow).toHaveClass('underline', 'min-h-target-min')
    await user.click(screen.getByRole('button', { name: 'Install' }))
    await user.click(notNow)
    expect(onInstall).toHaveBeenCalledTimes(1)
    expect(onNotNow).toHaveBeenCalledTimes(1)
  })
})
