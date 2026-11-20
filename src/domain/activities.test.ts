import {
  ACTIVITY_CATEGORIES,
  buildPickerSections,
  chipLabel,
  chipMeta,
  CUSTOM_ACTIVITY_ICON,
  isSameSelection,
  matchesGroupCustom,
  PRESET_ICONS,
  presetIcon,
  type GroupActivity,
} from '@/domain/activities'
import { TEST_PRESETS } from '@/test/fake-backend'

const GYM_ROW: GroupActivity = {
  id: 'ga-gym',
  groupId: 'g1',
  presetKey: 'gym',
  customName: null,
  createdBy: 'user-2',
  lockedScheduleType: 'times_per_week',
}
const STUDY_ROW: GroupActivity = {
  ...GYM_ROW,
  id: 'ga-study',
  presetKey: 'study',
  lockedScheduleType: null,
}
const POTTERY_ROW: GroupActivity = {
  id: 'ga-pottery',
  groupId: 'g1',
  presetKey: null,
  customName: 'Pottery',
  createdBy: 'user-3',
  lockedScheduleType: null,
}
const BAKING_ROW: GroupActivity = { ...POTTERY_ROW, id: 'ga-baking', customName: 'baking' }

describe('activity categories and icons', () => {
  it('lists the four categories in picker order with their labels', () => {
    expect(ACTIVITY_CATEGORIES.map((c) => c.label)).toEqual([
      'Fitness',
      'Mind',
      'Creative',
      'Life & work',
    ])
  })

  it('has an icon for every preset, and the sparkle for anything else', () => {
    for (const preset of TEST_PRESETS) expect(PRESET_ICONS[preset.key]).toBeDefined()
    expect(Object.keys(PRESET_ICONS)).toHaveLength(20)
    expect(presetIcon('surfing')).toBe(CUSTOM_ACTIVITY_ICON)
  })
})

describe('buildPickerSections', () => {
  it('without group activities: the four preset sections, five chips each, in sort order', () => {
    const shuffled = [...TEST_PRESETS].reverse()
    const sections = buildPickerSections(shuffled, [])
    expect(sections.map((s) => s.label)).toEqual(['Fitness', 'Mind', 'Creative', 'Life & work'])
    expect(sections.map((s) => s.chips.map((c) => c.name))).toEqual([
      ['Gym', 'Run', 'Walk', 'Yoga', 'Sports'],
      ['Study', 'Read', 'Meditate', 'Journal', 'Language practice'],
      ['Paint', 'Draw', 'Music practice', 'Write', 'Photography'],
      ['Side business', 'Cook at home', 'Clean', 'Groceries', 'Sleep early'],
    ])
  })

  it('puts In this group first: its presets in preset order, then custom activities by name', () => {
    const sections = buildPickerSections(TEST_PRESETS, [
      POTTERY_ROW,
      STUDY_ROW,
      BAKING_ROW,
      GYM_ROW,
    ])
    expect(sections.map((s) => s.label)).toEqual([
      'In this group',
      'Fitness',
      'Mind',
      'Creative',
      'Life & work',
    ])
    const group = sections[0]!
    expect(group.chips.map((c) => c.name)).toEqual(['Gym', 'Study', 'baking', 'Pottery'])
    expect(group.chips[2]?.icon).toBe(CUSTOM_ACTIVITY_ICON)
    expect(group.chips[0]?.icon).toBe(PRESET_ICONS.gym)
  })

  it('a preset in In this group is also in its category; both select the preset and show its lock', () => {
    const sections = buildPickerSections(TEST_PRESETS, [GYM_ROW, POTTERY_ROW])
    const inGroup = sections[0]!.chips.find((c) => c.name === 'Gym')!
    const inFitness = sections[1]!.chips.find((c) => c.name === 'Gym')!
    expect(inGroup.id).not.toBe(inFitness.id)
    expect(inGroup.selection).toEqual({ kind: 'preset', presetKey: 'gym' })
    expect(inFitness.selection).toEqual({ kind: 'preset', presetKey: 'gym' })
    expect(inGroup.lockedScheduleType).toBe('times_per_week')
    expect(inFitness.lockedScheduleType).toBe('times_per_week')
    const pottery = sections[0]!.chips.find((c) => c.name === 'Pottery')!
    expect(pottery.selection).toEqual({ kind: 'group', groupActivityId: 'ga-pottery' })
  })

  it('skips sections with no chips (presets not loaded yet)', () => {
    expect(buildPickerSections([], [])).toEqual([])
    const sections = buildPickerSections([], [POTTERY_ROW, GYM_ROW])
    expect(sections.map((s) => s.label)).toEqual(['In this group'])
    expect(sections[0]!.chips.map((c) => c.name)).toEqual(['Pottery'])
  })

  it('gives every chip a unique id', () => {
    const chips = buildPickerSections(TEST_PRESETS, [GYM_ROW, STUDY_ROW, POTTERY_ROW]).flatMap(
      (s) => s.chips,
    )
    expect(new Set(chips.map((c) => c.id)).size).toBe(chips.length)
  })
})

describe('isSameSelection', () => {
  it('compares kind and key', () => {
    expect(isSameSelection(null, null)).toBe(true)
    expect(isSameSelection(null, { kind: 'preset', presetKey: 'gym' })).toBe(false)
    expect(
      isSameSelection({ kind: 'preset', presetKey: 'gym' }, { kind: 'preset', presetKey: 'gym' }),
    ).toBe(true)
    expect(
      isSameSelection({ kind: 'preset', presetKey: 'gym' }, { kind: 'preset', presetKey: 'run' }),
    ).toBe(false)
    expect(
      isSameSelection(
        { kind: 'group', groupActivityId: 'a' },
        { kind: 'group', groupActivityId: 'a' },
      ),
    ).toBe(true)
    expect(
      isSameSelection(
        { kind: 'group', groupActivityId: 'gym' },
        { kind: 'preset', presetKey: 'gym' },
      ),
    ).toBe(false)
    expect(isSameSelection({ kind: 'custom', name: 'x' }, { kind: 'custom', name: 'x' })).toBe(true)
  })
})

describe('matchesGroupCustom', () => {
  it('matches a group custom activity by trimmed, case-insensitive name', () => {
    expect(matchesGroupCustom('  pottery ', [GYM_ROW, POTTERY_ROW])).toBe(POTTERY_ROW)
    expect(matchesGroupCustom('POTTERY', [POTTERY_ROW])).toBe(POTTERY_ROW)
  })

  it('ignores presets, partial names and blank text', () => {
    expect(matchesGroupCustom('gym', [GYM_ROW])).toBeNull()
    expect(matchesGroupCustom('Pot', [POTTERY_ROW])).toBeNull()
    expect(matchesGroupCustom('   ', [POTTERY_ROW])).toBeNull()
  })
})

describe('chip text', () => {
  it('names a locked schedule type in the meta and the accessible name', () => {
    const chip = { name: 'Gym', lockedScheduleType: 'times_per_week' as const }
    expect(chipMeta(chip)).toBe('· times per week')
    expect(chipLabel(chip)).toBe('Gym, times per week')
    expect(chipLabel({ name: 'Run', lockedScheduleType: 'fixed_days' })).toBe('Run, fixed days')
  })

  it('an unlocked chip is just its name', () => {
    expect(chipMeta({ lockedScheduleType: null })).toBeNull()
    expect(chipLabel({ name: 'Pottery', lockedScheduleType: null })).toBe('Pottery')
  })
})
