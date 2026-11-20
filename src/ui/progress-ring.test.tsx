import { render, screen } from '@testing-library/react'
import { ProgressRing } from '@/ui/progress-ring'
import { ringFraction } from '@/ui/ring-fraction'

describe('ProgressRing', () => {
  it('is one image named by its label, with the fraction centered and hidden from assistive tech', () => {
    const { container } = render(
      <ProgressRing value={0} target={3} label="Gym, 0 of 3 this week" />,
    )
    const ring = screen.getByRole('img', { name: 'Gym, 0 of 3 this week' })
    expect(ring).toHaveTextContent('0/3')
    expect(container.querySelector('[data-ring-progress]')).toBeNull()
    expect(container.querySelector('[data-ring-check]')).toBeNull()
    expect(ring).not.toHaveAttribute('data-met')
  })

  it('draws part of the ring below target', () => {
    const { container } = render(
      <ProgressRing value={2} target={3} label="Gym, 2 of 3 this week" />,
    )
    const progress = container.querySelector('[data-ring-progress]')
    const [drawn, total] = (progress?.getAttribute('stroke-dasharray') ?? '').split(' ').map(Number)
    expect(drawn).toBeCloseTo(((total ?? 0) * 2) / 3, 1)
    expect(container.querySelector('[data-ring-check]')).toBeNull()
  })

  it('is a full ring with a check at target, and never overfills', () => {
    const { container, rerender } = render(
      <ProgressRing value={3} target={3} label="Gym, 3 of 3 this week" />,
    )
    const dash = () =>
      (container.querySelector('[data-ring-progress]')?.getAttribute('stroke-dasharray') ?? '')
        .split(' ')
        .map(Number)
    const [full, total] = dash()
    expect(full).toBeCloseTo(total ?? 0, 1)
    expect(container.querySelector('[data-ring-check]')).not.toBeNull()
    expect(screen.getByRole('img')).toHaveAttribute('data-met')

    rerender(<ProgressRing value={5} target={3} label="Gym, 5 of 3 this week" />)
    const [over, overTotal] = dash()
    expect(over).toBeCloseTo(overTotal ?? 0, 1)
    expect(screen.getByRole('img')).toHaveTextContent('5/3')
  })

  it('ringFraction clamps to 0..1', () => {
    expect(ringFraction(0, 3)).toBe(0)
    expect(ringFraction(1, 4)).toBe(0.25)
    expect(ringFraction(9, 3)).toBe(1)
    expect(ringFraction(1, 0)).toBe(0)
    expect(ringFraction(-1, 3)).toBe(0)
  })
})
