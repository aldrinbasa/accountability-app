import { render, screen } from '@testing-library/react'
import { Avatar } from '@/ui/avatar'
import { AVATAR_FILLS, avatarFill, avatarInitial } from '@/ui/avatar-fill'

describe('avatarFill', () => {
  it('is deterministic and always one of the four fills', () => {
    const ids = ['user-1', 'user-2', 'b3f1c2d4-0000-4000-8000-000000000000', '']
    for (const id of ids) {
      expect(AVATAR_FILLS).toContain(avatarFill(id))
      expect(avatarFill(id)).toBe(avatarFill(id))
    }
  })

  it('spreads ids over all four fills', () => {
    const seen = new Set(Array.from({ length: 64 }, (_, i) => avatarFill(`user-${i}`)))
    expect(seen.size).toBe(AVATAR_FILLS.length)
  })
})

describe('avatarInitial', () => {
  it('takes the first character of the trimmed name, uppercased', () => {
    expect(avatarInitial('  jo')).toBe('J')
    expect(avatarInitial('élan')).toBe('É')
    expect(avatarInitial('😀 smile')).toBe('😀')
  })

  it('is empty for a blank name', () => {
    expect(avatarInitial('')).toBe('')
    expect(avatarInitial('   ')).toBe('')
  })
})

describe('Avatar', () => {
  it('draws the initial at the chosen size; decorative without a label', () => {
    const { container } = render(<Avatar id="user-1" name="jo" size={104} />)
    const circle = container.querySelector('[data-fill]')
    expect(circle).toHaveTextContent('J')
    expect(circle).toHaveAttribute('aria-hidden', 'true')
    expect(circle).toHaveClass('size-[104px]', 'rounded-full', 'border-obj-ink')
    expect(circle).toHaveAttribute('data-fill', avatarFill('user-1'))
  })

  it('is an image with a label, and renders the badge slot', () => {
    render(<Avatar id="user-1" name="Jo" label="Jo" badge={<button type="button">Badge</button>} />)
    expect(screen.getByRole('img', { name: 'Jo' })).toHaveClass('size-[38px]')
    expect(screen.getByRole('button', { name: 'Badge' })).toBeInTheDocument()
  })
})
