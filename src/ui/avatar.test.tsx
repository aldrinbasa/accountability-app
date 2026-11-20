import { fireEvent, render, screen } from '@testing-library/react'
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

  it('shows the initial while the photo loads, the photo once loaded, the initial again on error', () => {
    const { container, rerender } = render(
      <Avatar id="user-1" name="Jo" label="Jo's photo" src="https://x/a.webp" />,
    )
    const circle = container.querySelector('[data-fill]')
    const img = container.querySelector('img')
    expect(circle).toHaveTextContent('J')
    expect(img).toHaveAttribute('alt', "Jo's photo")
    expect(img).toHaveClass('opacity-0')
    expect(circle).not.toHaveAttribute('data-photo')
    // While loading, the circle is the one image.
    expect(screen.getByRole('img', { name: "Jo's photo" })).toBe(circle)

    fireEvent.load(img!)
    expect(img).toHaveClass('opacity-100')
    expect(circle).toHaveAttribute('data-photo')
    expect(screen.getByRole('img', { name: "Jo's photo" })).toBe(img)

    rerender(<Avatar id="user-1" name="Jo" label="Jo's photo" src="https://x/b.webp" />)
    fireEvent.error(container.querySelector('img')!)
    expect(container.querySelector('img')).toHaveClass('opacity-0')
    expect(circle).not.toHaveAttribute('data-photo')
    expect(circle).toHaveTextContent('J')
  })

  it('without a photo there is no image; without a label the photo is hidden from assistive tech', () => {
    const { container, rerender } = render(<Avatar id="user-1" name="Jo" src={null} />)
    expect(container.querySelector('img')).toBeNull()
    rerender(<Avatar id="user-1" name="Jo" src="https://x/a.webp" />)
    const img = container.querySelector('img')
    expect(img).toHaveAttribute('alt', '')
    expect(img).toHaveAttribute('aria-hidden', 'true')
  })

  it('a re-signed URL of the same photo stays up; a different photo waits for its own load', () => {
    const { container, rerender } = render(
      <Avatar id="user-1" name="Jo" label="Jo's photo" src="https://x/a.webp?token=1" />,
    )
    const circle = container.querySelector('[data-fill]')
    fireEvent.load(container.querySelector('img')!)
    expect(circle).toHaveAttribute('data-photo')

    rerender(<Avatar id="user-1" name="Jo" label="Jo's photo" src="https://x/a.webp?token=2" />)
    expect(circle).toHaveAttribute('data-photo')

    rerender(<Avatar id="user-1" name="Jo" label="Jo's photo" src="https://x/b.webp?token=1" />)
    expect(circle).not.toHaveAttribute('data-photo')
    expect(container.querySelector('img')).toHaveClass('opacity-0')
    expect(screen.getByRole('img', { name: "Jo's photo" })).toBe(circle)

    fireEvent.load(container.querySelector('img')!)
    expect(circle).toHaveAttribute('data-photo')
  })

  it('after the URL goes away (offline), the same photo waits for a fresh load; a later load clears an error', () => {
    const { container, rerender } = render(
      <Avatar id="user-1" name="Jo" label="Jo's photo" src="https://x/a.webp?token=1" />,
    )
    const circle = container.querySelector('[data-fill]')
    fireEvent.load(container.querySelector('img')!)
    expect(circle).toHaveAttribute('data-photo')

    rerender(<Avatar id="user-1" name="Jo" label="Jo's photo" src={null} />)
    rerender(<Avatar id="user-1" name="Jo" label="Jo's photo" src="https://x/a.webp?token=2" />)
    expect(circle).not.toHaveAttribute('data-photo')

    fireEvent.error(container.querySelector('img')!)
    expect(circle).not.toHaveAttribute('data-photo')
    fireEvent.load(container.querySelector('img')!)
    expect(circle).toHaveAttribute('data-photo')
  })
})
