import { useState } from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Sheet } from '@/ui/sheet'

function dragHandle(): Element {
  const handle = document.querySelector('[data-sheet-drag]')
  if (!handle) throw new Error('no drag handle')
  return handle
}

function Harness({ dirty = false }: { dirty?: boolean }) {
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState('')
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        open
      </button>
      <Sheet open={open} onOpenChange={setOpen} title="Test sheet" dirty={dirty && value !== ''}>
        <input aria-label="note" value={value} onChange={(e) => setValue(e.target.value)} />
      </Sheet>
    </>
  )
}

function TwoSheets() {
  const [which, setWhich] = useState<'a' | 'b' | null>(null)
  return (
    <>
      <button type="button" onClick={() => setWhich('a')}>
        open a
      </button>
      <Sheet open={which === 'a'} onOpenChange={(o) => !o && setWhich(null)} title="Sheet A">
        <button type="button" onClick={() => setWhich('b')}>
          open b
        </button>
      </Sheet>
      <Sheet open={which === 'b'} onOpenChange={(o) => !o && setWhich(null)} title="Sheet B">
        <p>b</p>
      </Sheet>
    </>
  )
}

describe('Sheet', () => {
  it('opens as a dialog with its title, focuses the first content control, returns focus on close', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    const trigger = screen.getByRole('button', { name: 'open' })
    await user.click(trigger)

    expect(await screen.findByRole('dialog', { name: 'Test sheet' })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'note' })).toHaveFocus()

    await user.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await waitFor(() => expect(trigger).toHaveFocus())
  })

  it('closes on Esc', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(screen.getByRole('button', { name: 'open' }))
    await screen.findByRole('dialog')
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('closes on system back (popstate)', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(screen.getByRole('button', { name: 'open' }))
    await screen.findByRole('dialog')
    expect(window.history.state).toMatchObject({ sheet: true })

    act(() => window.history.back())
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(window.history.state?.sheet).not.toBe(true)
  })

  it('asks "Discard this?" before closing a sheet with unsaved input', async () => {
    const user = userEvent.setup()
    render(<Harness dirty />)
    await user.click(screen.getByRole('button', { name: 'open' }))
    await user.type(await screen.findByRole('textbox', { name: 'note' }), 'taco')

    await user.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.getByText('Discard this?')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Keep' }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'note' })).toHaveValue('taco')

    await user.keyboard('{Escape}')
    await user.click(screen.getByRole('button', { name: 'Discard' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('keeps only one sheet open at a time', async () => {
    const user = userEvent.setup()
    render(<TwoSheets />)
    await user.click(screen.getByRole('button', { name: 'open a' }))
    await user.click(await screen.findByRole('button', { name: 'open b' }))

    expect(await screen.findByRole('dialog', { name: 'Sheet B' })).toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: 'Sheet A' })).not.toBeInTheDocument()
  })

  it('drops its history entry after closing', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(screen.getByRole('button', { name: 'open' }))
    await screen.findByRole('dialog')
    expect(window.history.state?.sheet).toBe(true)

    await user.click(screen.getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(window.history.state?.sheet).not.toBe(true))
  })

  it('on system back with unsaved input, asks first and keeps the sheet and its entry', async () => {
    const user = userEvent.setup()
    render(<Harness dirty />)
    await user.click(screen.getByRole('button', { name: 'open' }))
    await user.type(await screen.findByRole('textbox', { name: 'note' }), 'taco')

    act(() => window.history.back())
    expect(await screen.findByText('Discard this?')).toBeInTheDocument()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(window.history.state?.sheet).toBe(true)
  })

  it('while "Discard this?" shows, Esc, Close and back act as Keep', async () => {
    const user = userEvent.setup()
    render(<Harness dirty />)
    await user.click(screen.getByRole('button', { name: 'open' }))
    await user.type(await screen.findByRole('textbox', { name: 'note' }), 'taco')

    await user.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.getByText('Discard this?')).toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(screen.queryByText('Discard this?')).not.toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'note' })).toHaveValue('taco')

    await user.click(screen.getByRole('button', { name: 'Close' }))
    await user.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.queryByText('Discard this?')).not.toBeInTheDocument()
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Close' }))
    act(() => window.history.back())
    await waitFor(() => expect(screen.queryByText('Discard this?')).not.toBeInTheDocument())
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(window.history.state?.sheet).toBe(true)
  })

  it('closes on a downward drag of 80px or more', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(screen.getByRole('button', { name: 'open' }))
    await screen.findByRole('dialog')

    fireEvent.pointerDown(dragHandle(), { clientY: 100, pointerId: 1 })
    fireEvent.pointerMove(dragHandle(), { clientY: 190, pointerId: 1 })
    fireEvent.pointerUp(dragHandle(), { clientY: 190, pointerId: 1 })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('does not close when the drag is cancelled', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(screen.getByRole('button', { name: 'open' }))
    await screen.findByRole('dialog')

    fireEvent.pointerDown(dragHandle(), { clientY: 100, pointerId: 1 })
    fireEvent.pointerMove(dragHandle(), { clientY: 200, pointerId: 1 })
    fireEvent.pointerCancel(dragHandle(), { clientY: 200, pointerId: 1 })
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })
})
