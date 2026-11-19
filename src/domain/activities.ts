import {
  Aperture,
  Barbell,
  BookOpenText,
  Books,
  Briefcase,
  Broom,
  CookingPot,
  FlowerLotus,
  MoonStars,
  MusicNotes,
  Notebook,
  PaintBrush,
  PenNib,
  PencilSimpleLine,
  PersonSimpleRun,
  PersonSimpleTaiChi,
  PersonSimpleWalk,
  ShoppingCart,
  SoccerBall,
  Sparkle,
  Translate,
  type Icon as PhosphorIcon,
} from '@phosphor-icons/react'

/** `preset_activities.category`, in display order. */
export type ActivityCategory = 'fitness' | 'mind' | 'creative' | 'life_work'

/** `group_activities.schedule_type`: the type every active commitment to an activity shares. */
export type ScheduleType = 'fixed_days' | 'times_per_week'

/** One of the 20 global presets (`preset_activities`). */
export interface PresetActivity {
  key: string
  name: string
  category: ActivityCategory
  /** Display order across the whole list. */
  sort: number
}

/**
 * A group's activity (`group_activity_options`): the group's row for a preset it has used, or a
 * member's free-typed custom activity. Exactly one of `presetKey` / `customName` is set.
 */
export interface GroupActivity {
  id: string
  groupId: string
  presetKey: string | null
  customName: string | null
  createdBy: string
  /** The schedule type while any current member has an active commitment to it (Story 2.2). */
  lockedScheduleType: ScheduleType | null
}

/**
 * What the Activity picker selects. A preset is always selected as `preset`, from either of its
 * chips; a group custom activity as `group`; text typed in "Something else" as `custom` (raw text,
 * trimmed by the server).
 */
export type ActivitySelection =
  | { kind: 'preset'; presetKey: string }
  | { kind: 'group'; groupActivityId: string }
  | { kind: 'custom'; name: string }
  | null

/** The four preset sections, in picker order. */
export const ACTIVITY_CATEGORIES: readonly { key: ActivityCategory; label: string }[] = [
  { key: 'fitness', label: 'Fitness' },
  { key: 'mind', label: 'Mind' },
  { key: 'creative', label: 'Creative' },
  { key: 'life_work', label: 'Life & work' },
]

const CATEGORY_KEYS: readonly string[] = ACTIVITY_CATEGORIES.map((category) => category.key)

export function isActivityCategory(value: unknown): value is ActivityCategory {
  return typeof value === 'string' && CATEGORY_KEYS.includes(value)
}

export function isScheduleType(value: unknown): value is ScheduleType {
  return value === 'fixed_days' || value === 'times_per_week'
}

/**
 * The preset icon map (DESIGN.md `activity-picker`, mockups/key-add-plan.html), keyed by preset key.
 * Always drawn Duotone and `aria-hidden`; never emoji or text glyphs.
 */
export const PRESET_ICONS: Readonly<Record<string, PhosphorIcon>> = {
  gym: Barbell,
  run: PersonSimpleRun,
  walk: PersonSimpleWalk,
  yoga: FlowerLotus,
  sports: SoccerBall,
  study: BookOpenText,
  read: Books,
  meditate: PersonSimpleTaiChi,
  journal: Notebook,
  language_practice: Translate,
  paint: PaintBrush,
  draw: PencilSimpleLine,
  music_practice: MusicNotes,
  write: PenNib,
  photography: Aperture,
  side_business: Briefcase,
  cook_at_home: CookingPot,
  clean: Broom,
  groceries: ShoppingCart,
  sleep_early: MoonStars,
}

/** Group custom activities (and any preset without a mapped icon) use the sparkle. */
export const CUSTOM_ACTIVITY_ICON: PhosphorIcon = Sparkle

export function presetIcon(presetKey: string): PhosphorIcon {
  return PRESET_ICONS[presetKey] ?? CUSTOM_ACTIVITY_ICON
}

/** The schedule type as a chip names it: "Gym · times per week". */
export const SCHEDULE_TYPE_LABEL: Record<ScheduleType, string> = {
  fixed_days: 'fixed days',
  times_per_week: 'times per week',
}

/** Custom activity names are trimmed and 1 to 24 characters (the database rule). */
export const CUSTOM_ACTIVITY_MAX = 24

/** Copy for the Activity picker (Story 2.1 ACs). */
export const ACTIVITY_COPY = {
  inThisGroup: 'In this group',
  somethingElse: 'Something else',
  matchHint: 'Pick it from In this group to share it.',
} as const

/** One chip in the picker. A preset can have two chips (In this group and its category). */
export interface PickerChip {
  /** Unique within the picker (React key). */
  id: string
  name: string
  icon: PhosphorIcon
  lockedScheduleType: ScheduleType | null
  /** What tapping the chip selects. */
  selection: Exclude<ActivitySelection, null>
}

export type PickerSectionKey = 'group' | ActivityCategory

export interface PickerSection {
  key: PickerSectionKey
  label: string
  chips: PickerChip[]
}

function sortedPresets(presets: readonly PresetActivity[]): PresetActivity[] {
  return [...presets].sort((a, b) => a.sort - b.sort)
}

function compareNames(a: string, b: string): number {
  const x = a.toLowerCase()
  const y = b.toLowerCase()
  if (x === y) return 0
  return x < y ? -1 : 1
}

/**
 * The picker's chip sections, in order: In this group (only when the group has activities: its
 * presets in preset order, then its custom activities by name), then Fitness, Mind, Creative and
 * Life & work. A preset with a group row appears in both In this group and its category; both chips
 * select `{ kind: 'preset' }` and both show the locked schedule type. "Something else" is the text
 * field after the chips, not a section.
 */
export function buildPickerSections(
  presets: readonly PresetActivity[],
  groupActivities: readonly GroupActivity[],
): PickerSection[] {
  const ordered = sortedPresets(presets)
  const groupRowByPreset = new Map<string, GroupActivity>()
  for (const row of groupActivities) {
    if (row.presetKey !== null) groupRowByPreset.set(row.presetKey, row)
  }

  const presetChip = (preset: PresetActivity, section: PickerSectionKey): PickerChip => ({
    id: `${section}:preset:${preset.key}`,
    name: preset.name,
    icon: presetIcon(preset.key),
    lockedScheduleType: groupRowByPreset.get(preset.key)?.lockedScheduleType ?? null,
    selection: { kind: 'preset', presetKey: preset.key },
  })

  const groupChips: PickerChip[] = [
    ...ordered
      .filter((preset) => groupRowByPreset.has(preset.key))
      .map((p) => presetChip(p, 'group')),
    ...groupActivities
      .filter((row): row is GroupActivity & { customName: string } => row.customName !== null)
      .sort((a, b) => compareNames(a.customName, b.customName) || compareNames(a.id, b.id))
      .map((row) => ({
        id: `group:custom:${row.id}`,
        name: row.customName,
        icon: CUSTOM_ACTIVITY_ICON,
        lockedScheduleType: row.lockedScheduleType,
        selection: { kind: 'group', groupActivityId: row.id } as const,
      })),
  ]

  const sections: PickerSection[] = []
  if (groupChips.length > 0) {
    sections.push({ key: 'group', label: ACTIVITY_COPY.inThisGroup, chips: groupChips })
  }
  for (const category of ACTIVITY_CATEGORIES) {
    const chips = ordered
      .filter((preset) => preset.category === category.key)
      .map((preset) => presetChip(preset, category.key))
    // No heading without chips (e.g. before the presets have loaded).
    if (chips.length > 0) sections.push({ key: category.key, label: category.label, chips })
  }
  return sections
}

/** Whether two selections pick the same activity (custom text compares exactly). */
export function isSameSelection(a: ActivitySelection, b: ActivitySelection): boolean {
  if (a === null || b === null) return a === b
  switch (a.kind) {
    case 'preset':
      return b.kind === 'preset' && a.presetKey === b.presetKey
    case 'group':
      return b.kind === 'group' && a.groupActivityId === b.groupActivityId
    case 'custom':
      return b.kind === 'custom' && a.name === b.name
  }
}

/**
 * The group custom activity whose name matches typed text (trimmed, case-insensitive), or null.
 * Typing it makes a separate activity (FR-10), so the picker hints to pick it from In this group.
 */
export function matchesGroupCustom(
  text: string,
  groupActivities: readonly GroupActivity[],
): GroupActivity | null {
  const typed = text.trim().toLowerCase()
  if (typed === '') return null
  return (
    groupActivities.find(
      (row) => row.customName !== null && row.customName.toLowerCase() === typed,
    ) ?? null
  )
}

/** The chip's visible meta: "· times per week" when the schedule type is locked, else null. */
export function chipMeta(chip: Pick<PickerChip, 'lockedScheduleType'>): string | null {
  return chip.lockedScheduleType ? `· ${SCHEDULE_TYPE_LABEL[chip.lockedScheduleType]}` : null
}

/** The chip's accessible name: "Gym, times per week" when locked, else "Gym". */
export function chipLabel(chip: Pick<PickerChip, 'name' | 'lockedScheduleType'>): string {
  return chip.lockedScheduleType
    ? `${chip.name}, ${SCHEDULE_TYPE_LABEL[chip.lockedScheduleType]}`
    : chip.name
}
