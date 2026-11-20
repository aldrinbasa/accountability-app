import { useState } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Stepper } from '@/ui/stepper'

function Harness({ initial = 3 }: { initial?: number }) {
  const [value, setValue] = useState(initial)
  return (
    <>
      <span id="lbl">Times per week</span>
      <Stepper
        value={value}
        onChange={setValue}
        min={1}
        max={7}
        unit="times per week"
        valueLabel={(n) => `${n} times per week`}
        decrementLabel="Fewer"
        incrementLabel="More"
        labelledBy="lbl"
      />
    </>
  )
}

describe('Stepper', () => {
  it('steps and announces the value with its unit', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    expect(screen.getByRole('group', { name: 'Times per week' })).toBeInTheDocument()
    const live = document.querySelector('[data-stepper-value]')
    expect(live).toHaveAttribute('aria-live', 'polite')
    expect(live).toHaveTextContent('3 times per week')
    await user.click(screen.getByRole('button', { name: 'More' }))
    expect(live).toHaveTextContent('4 times per week')
    await user.click(screen.getByRole('button', { name: 'Fewer' }))
    await user.click(screen.getByRole('button', { name: 'Fewer' }))
    expect(live).toHaveTextContent('2 times per week')
  })

  it('hides minus at 1 and plus at 7, and moves focus to the other button', async () => {
    const user = userEvent.setup()
    render(<Harness initial={2} />)
    const fewer = screen.getByRole('button', { name: 'Fewer' })
    await user.click(fewer)
    expect(screen.queryByRole('button', { name: 'Fewer' })).not.toBeInTheDocument()
    expect(fewer).toHaveAttribute('tabindex', '-1')
    await vi.waitFor(() => expect(screen.getByRole('button', { name: 'More' })).toHaveFocus())

    for (let i = 0; i < 6; i += 1) await user.click(screen.getByRole('button', { name: 'More' }))
    expect(document.querySelector('[data-stepper-value]')).toHaveTextContent('7 times per week')
    expect(screen.queryByRole('button', { name: 'More' })).not.toBeInTheDocument()
    await vi.waitFor(() => expect(screen.getByRole('button', { name: 'Fewer' })).toHaveFocus())
  })
})
