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

function SingleHarness({
  days,
  initial = null,
  onChange,
}: {
  days: WeekdayOption[]
  initial?: number | null
  onChange?: (day: number) => void
}) {
  const [value, setValue] = useState<number | null>(initial)
  return (
    <>
      <span id="dl">Deadline</span>
      <WeekdaySelector
        mode="single"
        days={days}
        value={value}
        labelledBy="dl"
        onChange={(day) => {
          setValue(day)
          onChange?.(day)
        }}
      />
    </>
  )
}

// Wednesday to Sunday, today labeled the way the Plan sheet passes it.
const FROM_WEDNESDAY: WeekdayOption[] = [
  { value: 3, letter: 'W', name: 'Today', caption: 'Today' },
  ...DAYS.slice(3),
]

describe('WeekdaySelector (single)', () => {
  it('shows only the given days as radios, with "Today" under today', () => {
    render(<SingleHarness days={FROM_WEDNESDAY} initial={7} />)
    const group = screen.getByRole('radiogroup', { name: 'Deadline' })
    const radios = within(group).getAllByRole('radio')
    expect(radios.map((r) => r.getAttribute('aria-label'))).toEqual([
      'Today',
      'Thursday',
      'Friday',
      'Saturday',
      'Sunday',
    ])
    expect(within(group).getByText('Today')).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Sunday' })).toBeChecked()
    expect(screen.getByRole('radio', { name: 'Sunday' })).toHaveAttribute('tabindex', '0')
    expect(screen.getByRole('radio', { name: 'Today' })).toHaveAttribute('tabindex', '-1')
  })

  it('on a Sunday only Today shows', () => {
    render(
      <SingleHarness
        days={[{ value: 7, letter: 'S', name: 'Today', caption: 'Today' }]}
        initial={7}
      />,
    )
    const radios = within(screen.getByRole('radiogroup', { name: 'Deadline' })).getAllByRole(
      'radio',
    )
    expect(radios).toHaveLength(1)
    expect(radios[0]).toHaveAccessibleName('Today')
    expect(radios[0]).toBeChecked()
  })

  it('a tap selects one day; arrow keys move and select', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<SingleHarness days={FROM_WEDNESDAY} initial={7} onChange={onChange} />)
    await user.click(screen.getByRole('radio', { name: 'Friday' }))
    expect(onChange).toHaveBeenLastCalledWith(5)
    expect(screen.getByRole('radio', { name: 'Friday' })).toBeChecked()
    expect(screen.getByRole('radio', { name: 'Sunday' })).not.toBeChecked()
    expect(screen.getByRole('radio', { name: 'Friday' }).querySelector('svg')).not.toBeNull()
    await user.keyboard('{ArrowRight}')
    expect(onChange).toHaveBeenLastCalledWith(6)
    expect(screen.getByRole('radio', { name: 'Saturday' })).toHaveFocus()
    await user.keyboard('{Home}')
    expect(onChange).toHaveBeenLastCalledWith(3)
    expect(screen.getByRole('radio', { name: 'Today' })).toHaveFocus()
    await user.keyboard('{ArrowLeft}')
    expect(onChange).toHaveBeenLastCalledWith(7)
  })
})
