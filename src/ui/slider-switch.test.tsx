import { useState } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DeviceMobile, Moon, Sun } from '@phosphor-icons/react'
import { SliderSwitch } from '@/ui/slider-switch'

const OPTIONS = [
  { value: 'system', label: 'Auto', icon: DeviceMobile },
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
] as const

type Value = (typeof OPTIONS)[number]['value']

function Harness({ onChange }: { onChange?: (v: Value) => void }) {
  const [value, setValue] = useState<Value>('system')
  return (
    <>
      <span id="lbl">Appearance</span>
      <SliderSwitch
        labelledBy="lbl"
        options={OPTIONS}
        value={value}
        onChange={(v) => {
          setValue(v)
          onChange?.(v)
        }}
      />
    </>
  )
}

function knob(container: HTMLElement): HTMLElement {
  const el = container.querySelector<HTMLElement>('[data-knob]')
  if (!el) throw new Error('no knob')
  return el
}

describe('SliderSwitch', () => {
  it('is a labelled radio group with one selected segment and one tab stop', () => {
    const { container } = render(<Harness />)
    expect(screen.getByRole('radiogroup', { name: 'Appearance' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Auto' })).toBeChecked()
    expect(screen.getByRole('radio', { name: 'Auto' })).toHaveAttribute('tabindex', '0')
    expect(screen.getByRole('radio', { name: 'Dark' })).toHaveAttribute('tabindex', '-1')
    expect(knob(container).style.transform).toBe('translateX(0%)')
  })

  it('selects on tap and moves the knob; a tap on the selected segment changes nothing', async () => {
    const onChange = vi.fn()
    const { container } = render(<Harness onChange={onChange} />)
    await userEvent.click(screen.getByRole('radio', { name: 'Dark' }))
    expect(screen.getByRole('radio', { name: 'Dark' })).toBeChecked()
    expect(onChange).toHaveBeenCalledWith('dark')
    expect(knob(container).style.transform).toBe('translateX(200%)')
    await userEvent.click(screen.getByRole('radio', { name: 'Dark' }))
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('arrow keys, Home and End move and select', async () => {
    render(<Harness />)
    screen.getByRole('radio', { name: 'Auto' }).focus()
    await userEvent.keyboard('{ArrowRight}')
    expect(screen.getByRole('radio', { name: 'Light' })).toBeChecked()
    expect(screen.getByRole('radio', { name: 'Light' })).toHaveFocus()
    await userEvent.keyboard('{ArrowLeft}{ArrowLeft}')
    expect(screen.getByRole('radio', { name: 'Dark' })).toBeChecked()
    await userEvent.keyboard('{Home}')
    expect(screen.getByRole('radio', { name: 'Auto' })).toBeChecked()
    await userEvent.keyboard('{End}')
    expect(screen.getByRole('radio', { name: 'Dark' })).toHaveFocus()
  })
})
