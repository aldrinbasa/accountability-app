import { render, screen } from '@testing-library/react'
import { Polaroid } from '@/ui/polaroid'

describe('Polaroid', () => {
  it('frames the photo with tape, the caption and the meta line', () => {
    render(
      <Polaroid
        photo={<img src="data:," alt="Your Gym check-in" />}
        caption="leg day. send help."
        meta="Gym · 3/3"
      />,
    )
    const figure = screen.getByRole('figure')
    expect(figure).toHaveAttribute('data-component', 'polaroid')
    expect(figure).toHaveClass('bg-pola', 'border-obj-ink', 'on-object', '-rotate-[2.2deg]')
    expect(figure.querySelector('[data-polaroid-tape]')).toHaveAttribute('aria-hidden', 'true')
    expect(screen.getByRole('img', { name: 'Your Gym check-in' })).toBeInTheDocument()
    expect(screen.getByText('leg day. send help.')).toHaveClass('type-hand-lg')
    expect(screen.getByText('Gym · 3/3')).toHaveClass('text-obj-muted')
  })

  it('tilts the other way with the other tape, and shows no meta line without one', () => {
    const { container } = render(<Polaroid tilt="right" caption={null} />)
    const figure = container.querySelector('figure')
    expect(figure).toHaveClass('rotate-2')
    expect(figure?.querySelector('[data-polaroid-tape]')).toHaveClass('bg-tape2')
    expect(figure?.querySelector('p')).toBeNull()
  })
})
