import { render, screen } from '@testing-library/react'
import { StreakCounter } from '@/ui/streak-counter'

describe('StreakCounter', () => {
  it('md: one image named by its label, the numeral in numeral-md streak color with its unit', () => {
    render(<StreakCounter value={6} label="Streak 6" unit="in a row" />)
    const counter = screen.getByRole('img', { name: 'Streak 6' })
    expect(counter).toHaveAttribute('data-size', 'md')
    const numeral = counter.querySelector('.type-numeral-md')
    expect(numeral).toHaveTextContent('6')
    expect(numeral).toHaveClass('text-streak')
    expect(counter).toHaveTextContent('in a row')
    expect(counter.querySelector('svg')).toHaveAttribute('width', '32')
  })

  it('sm: the numeral in title-sm ink beside a 20px fire, never the streak color, no unit', () => {
    render(<StreakCounter value={8} label="Best current streak 8" unit="in a row" size="sm" />)
    const counter = screen.getByRole('img', { name: 'Best current streak 8' })
    const numeral = counter.querySelector('.type-title-sm')
    expect(numeral).toHaveTextContent('8')
    expect(numeral).toHaveClass('text-ink')
    expect(numeral).not.toHaveClass('text-streak')
    expect(counter).not.toHaveTextContent('in a row')
    const fire = counter.querySelector('svg')
    expect(fire).toHaveAttribute('width', '20')
    expect(fire).toHaveClass('text-streak')
  })

  it('pops the numeral only when asked', () => {
    const { rerender } = render(<StreakCounter value={3} label="Streak 3" />)
    expect(document.querySelector('.animate-streak-pop')).toBeNull()
    rerender(<StreakCounter value={3} label="Streak 3" pop />)
    expect(document.querySelector('.animate-streak-pop')).toHaveTextContent('3')
  })
})
