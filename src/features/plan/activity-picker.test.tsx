import { useState } from 'react'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ActivitySelection, GroupActivity } from '@/domain/activities'
import { ActivityPicker } from '@/features/plan/activity-picker'
import { TEST_PRESETS } from '@/test/fake-backend'

const GROUP_ACTIVITIES: GroupActivity[] = [
  {
    id: 'ga-gym',
    groupId: 'g1',
    presetKey: 'gym',
    customName: null,
    createdBy: 'user-2',
    lockedScheduleType: 'times_per_week',
  },
  {
    id: 'ga-pottery',
    groupId: 'g1',
    presetKey: null,
    customName: 'Pottery',
    createdBy: 'user-3',
    lockedScheduleType: null,
  },
]

function Harness({
  initial = null,
  groupActivities = GROUP_ACTIVITIES,
  onChange,
}: {
  initial?: ActivitySelection
  groupActivities?: GroupActivity[]
  onChange?: (value: ActivitySelection) => void
}) {
  const [value, setValue] = useState<ActivitySelection>(initial)
  return (
    <>
      <span id="activity-label">Activity</span>
      <button type="button">Before</button>
      <ActivityPicker
        presets={TEST_PRESETS}
        groupActivities={groupActivities}
        value={value}
        labelledBy="activity-label"
        onChange={(next) => {
          setValue(next)
          onChange?.(next)
        }}
      />
    </>
  )
}

function headings(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('[data-picker-heading]')).map(
    (node) => node.textContent ?? '',
  )
}

describe('ActivityPicker', () => {
  it('shows the sections in order, with In this group holding its presets and custom activities', () => {
    const { container } = render(<Harness />)
    expect(headings(container)).toEqual([
      'In this group',
      'Fitness',
      'Mind',
      'Creative',
      'Life & work',
    ])
    // "Something else" is the labelled text field after the chips.
    const custom = screen.getByRole('textbox', { name: 'Something else' })
    const lastHeading = container.querySelectorAll('[data-picker-heading]')[4]!
    expect(
      lastHeading.compareDocumentPosition(custom) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()

    const group = screen.getByRole('radiogroup', { name: 'Activity' })
    const gyms = within(group).getAllByRole('radio', { name: 'Gym, times per week' })
    expect(gyms).toHaveLength(2)
    for (const gym of gyms) expect(gym).toHaveTextContent('Gym · times per week')
    // The first Gym is in In this group (before the Fitness one), next to Pottery.
    const radios = within(group).getAllByRole('radio')
    expect(radios.slice(0, 2).map((r) => r.textContent)).toEqual([
      'Gym · times per week',
      'Pottery',
    ])
    expect(screen.getByRole('radio', { name: 'Pottery' }).querySelector('svg')).toHaveAttribute(
      'aria-hidden',
      'true',
    )
    expect(radios).toHaveLength(22)
  })

  it('hides In this group when the group has no activities', () => {
    const { container } = render(<Harness groupActivities={[]} />)
    expect(headings(container)).toEqual(['Fitness', 'Mind', 'Creative', 'Life & work'])
    expect(screen.getByRole('radio', { name: 'Gym' })).toBeInTheDocument()
  })

  it.each([0, 1])('tapping either Gym chip (#%i) checks both and selects the preset', async (n) => {
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)
    await userEvent.click(screen.getAllByRole('radio', { name: 'Gym, times per week' })[n]!)
    expect(onChange).toHaveBeenCalledWith({ kind: 'preset', presetKey: 'gym' })
    for (const gym of screen.getAllByRole('radio', { name: 'Gym, times per week' })) {
      expect(gym).toHaveAttribute('aria-checked', 'true')
      expect(gym).toHaveClass('bg-ink', 'text-card')
    }
    expect(screen.getByRole('radio', { name: 'Run' })).toHaveAttribute('aria-checked', 'false')
  })

  it('a group custom activity is selected as group', async () => {
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)
    await userEvent.click(screen.getByRole('radio', { name: 'Pottery' }))
    expect(onChange).toHaveBeenCalledWith({ kind: 'group', groupActivityId: 'ga-pottery' })
    expect(screen.getByRole('radio', { name: 'Pottery' })).toHaveAttribute('aria-checked', 'true')
  })

  it('typing selects custom and unchecks every chip; tapping a chip clears the text', async () => {
    const onChange = vi.fn()
    render(<Harness initial={{ kind: 'preset', presetKey: 'run' }} onChange={onChange} />)
    const field = screen.getByRole('textbox', { name: 'Something else' })
    expect(field).toHaveAttribute('maxlength', '24')
    await userEvent.type(field, 'Bouldering')
    expect(onChange).toHaveBeenLastCalledWith({ kind: 'custom', name: 'Bouldering' })
    expect(screen.queryAllByRole('radio', { checked: true })).toHaveLength(0)
    await userEvent.click(screen.getByRole('radio', { name: 'Walk' }))
    expect(field).toHaveValue('')
    expect(screen.getByRole('radio', { name: 'Walk' })).toHaveAttribute('aria-checked', 'true')
    // Clearing the text leaves nothing selected.
    await userEvent.type(field, 'x')
    await userEvent.clear(field)
    expect(onChange).toHaveBeenLastCalledWith(null)
    // Whitespace alone is not a custom name; text with spaces is kept raw.
    await userEvent.type(field, '  ')
    expect(onChange).toHaveBeenLastCalledWith(null)
    expect(screen.queryAllByRole('radio', { checked: true })).toHaveLength(0)
    expect(field).toHaveValue('')
    await userEvent.type(field, 'Kayak ')
    expect(onChange).toHaveBeenLastCalledWith({ kind: 'custom', name: 'Kayak ' })
  })

  it('a typed name matching a group custom activity shows the hint, linked to the field', async () => {
    render(<Harness />)
    const field = screen.getByRole('textbox', { name: 'Something else' })
    await userEvent.type(field, ' pottery')
    const hint = screen.getByText('Pick it from In this group to share it.')
    expect(field.getAttribute('aria-describedby')?.split(' ')).toContain(hint.id)
    expect(field).toHaveAccessibleDescription('Pick it from In this group to share it.')
    await userEvent.type(field, 's')
    expect(screen.queryByText('Pick it from In this group to share it.')).not.toBeInTheDocument()
    expect(field).not.toHaveAttribute('aria-describedby')
  })

  it('keyboard: one tab stop, arrow keys move and select, Home and End jump', async () => {
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)
    screen.getByRole('button', { name: 'Before' }).focus()
    await userEvent.tab()
    const radios = screen.getAllByRole('radio')
    expect(radios[0]).toHaveFocus()
    expect(radios.filter((r) => r.tabIndex === 0)).toHaveLength(1)

    await userEvent.keyboard('{ArrowRight}')
    expect(screen.getByRole('radio', { name: 'Pottery' })).toHaveFocus()
    expect(onChange).toHaveBeenLastCalledWith({ kind: 'group', groupActivityId: 'ga-pottery' })

    // Onto the Fitness Gym chip: both Gym chips check, focus and the tab stop stay on this one.
    await userEvent.keyboard('{ArrowRight}')
    const fitnessGym = screen.getAllByRole('radio', { name: 'Gym, times per week' })[1]!
    expect(fitnessGym).toHaveFocus()
    expect(fitnessGym).toHaveAttribute('tabindex', '0')
    expect(screen.getAllByRole('radio').filter((r) => r.tabIndex === 0)).toHaveLength(1)

    await userEvent.keyboard('{ArrowDown}')
    expect(screen.getByRole('radio', { name: 'Run' })).toHaveFocus()
    expect(screen.getByRole('radio', { name: 'Run' })).toHaveAttribute('aria-checked', 'true')
    await userEvent.keyboard('{ArrowLeft}{ArrowUp}')
    expect(screen.getByRole('radio', { name: 'Pottery' })).toHaveFocus()
    await userEvent.keyboard('{End}')
    expect(screen.getByRole('radio', { name: 'Sleep early' })).toHaveFocus()
    expect(onChange).toHaveBeenLastCalledWith({ kind: 'preset', presetKey: 'sleep_early' })
    await userEvent.keyboard('{ArrowRight}')
    expect(radios[0]).toHaveFocus()
    await userEvent.keyboard('{End}{Home}')
    expect(radios[0]).toHaveFocus()

    // Tab leaves the chips for the text field.
    await userEvent.tab()
    expect(screen.getByRole('textbox', { name: 'Something else' })).toHaveFocus()
  })

  it('tabbing in lands on the checked chip', async () => {
    render(<Harness initial={{ kind: 'preset', presetKey: 'yoga' }} />)
    screen.getByRole('button', { name: 'Before' }).focus()
    await userEvent.tab()
    expect(screen.getByRole('radio', { name: 'Yoga' })).toHaveFocus()
  })

  it('every chip is a 44px radio with an aria-hidden icon', () => {
    render(<Harness />)
    for (const radio of screen.getAllByRole('radio')) {
      expect(radio).toHaveClass('min-h-target-min')
      expect(radio.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
    }
  })
})
