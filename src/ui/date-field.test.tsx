import { useState } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DateField } from '@/ui/date-field'

function Harness({ error }: { error?: string }) {
  const [value, setValue] = useState<string | null>(null)
  return (
    <DateField
      label="End date (optional)"
      value={value}
      displayValue={value ? `shown ${value}` : ''}
      emptyText="No end date"
      min="2026-11-29"
      onChange={setValue}
      clearLabel="Clear end date"
      error={error}
      hint="A note"
    />
  )
}

describe('DateField', () => {
  it('reads "No end date" when empty, with a labelled native date input and its earliest choice', () => {
    render(<Harness />)
    expect(screen.getByText('No end date')).toBeInTheDocument()
    const input = screen.getByLabelText('End date (optional)')
    expect(input).toHaveAttribute('type', 'date')
    expect(input).toHaveAttribute('min', '2026-11-29')
    expect(input).toHaveAccessibleDescription('A note')
    expect(screen.queryByRole('button', { name: 'Clear end date' })).not.toBeInTheDocument()
  })

  it('shows the chosen date and clears it with the 44px clear button', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    fireEvent.change(screen.getByLabelText('End date (optional)'), {
      target: { value: '2026-12-04' },
    })
    expect(screen.getByText('shown 2026-12-04')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Clear end date' }))
    expect(screen.getByText('No end date')).toBeInTheDocument()
    expect(screen.getByLabelText('End date (optional)')).toHaveValue('')
  })

  it('links a field error and marks the input invalid', () => {
    render(<Harness error="End date has to be on or after Sun 29 Nov." />)
    const input = screen.getByLabelText('End date (optional)')
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(input).toHaveAccessibleDescription('A note End date has to be on or after Sun 29 Nov.')
    expect(screen.getByRole('alert')).toHaveTextContent(
      'End date has to be on or after Sun 29 Nov.',
    )
  })
})
