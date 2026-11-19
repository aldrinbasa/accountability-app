import { useState } from 'react'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { WeekdaySelector, type WeekdayOption } from '@/ui/weekday-selector'

const DAYS: WeekdayOption[] = [
  { value: 1, letter: 'M', name: 'Monday' },
  { value: 2, letter: 'T', name: 'Tuesday' },
  { value: 3, letter: 'W', name: 'Wednesday' },
  { value: 4, letter: 'T', name: 'Thursday' },
  { value: 5, letter: 'F', name: 'Friday' },
  { value: 6, letter: 'S', name: 'Saturday' },
  { value: 7, letter: 'S', name: 'Sunday' },
]

function Harness({ onChange }: { onChange?: (days: number[]) => void }) {
  const [value, setValue] = useState<number[]>([])
  return (
    <>
      <span id="lbl">Days</span>
      <WeekdaySelector
        days={DAYS}
        value={value}
        labelledBy="lbl"
        onChange={(days) => {
          setValue(days)
          onChange?.(days)
        }}
      />
    </>
  )
}

describe('WeekdaySelector (multi)', () => {
  it('shows seven toggles M T W T F S S named by full day', () => {
    render(<Harness />)
    const group = screen.getByRole('group', { name: 'Days' })
    const buttons = within(group).getAllByRole('button')
    expect(buttons.map((b) => b.textContent)).toEqual(['M', 'T', 'W', 'T', 'F', 'S', 'S'])
    expect(buttons.map((b) => b.getAttribute('aria-label'))).toEqual([
      'Monday',
      'Tuesday',
      'Wednesday',
      'Thursday',
      'Friday',
      'Saturday',
      'Sunday',
    ])
  })

  it('toggles days on and off; a selected day says so and shows a check', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)
    await user.click(screen.getByRole('button', { name: 'Friday' }))
    const friday = screen.getByRole('button', { name: 'Friday, selected' })
    expect(friday).toHaveAttribute('aria-pressed', 'true')
    expect(friday.querySelector('svg')).not.toBeNull()
    await user.click(screen.getByRole('button', { name: 'Monday' }))
    expect(onChange).toHaveBeenLastCalledWith([5, 1])
    await user.click(friday)
    expect(onChange).toHaveBeenLastCalledWith([1])
    expect(screen.getByRole('button', { name: 'Friday' })).toHaveAttribute('aria-pressed', 'false')
  })
})
