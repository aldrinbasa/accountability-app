import { useState } from 'react'
import { CaretDown } from '@phosphor-icons/react'
import { isWaiting, switcherLabel } from '@/domain/groups'
import { Icon } from '@/ui/icon'
import { GroupDot } from '@/features/group/group-dot'
import { useFocusedGroup } from '@/features/group/use-focused-group'
import { YourGroupsSheet } from '@/features/group/your-groups-sheet'

/**
 * Top-bar group switcher (DESIGN.md `group-switcher`) on Today, Feed and Board: a card pill with the
 * group dot, the focused group's name and a caret. Opens the "Your groups" sheet. Renders nothing
 * until a focused group exists (no groups, still loading, or a failed load).
 */
export function GroupSwitcher() {
  const { group, groups, setFocus } = useFocusedGroup()
  const [open, setOpen] = useState(false)

  if (!group || !groups) return null

  return (
    <>
      <button
        type="button"
        aria-label={switcherLabel(group)}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
        className="inline-flex min-h-target-min max-w-full items-center gap-2 rounded-wob-sm border-[2.5px] border-line bg-card px-3 text-ink shadow-ink type-title press-offset"
      >
        <GroupDot waiting={isWaiting(group)} />
        <span className="min-w-0 truncate">{group.name}</span>
        <Icon icon={CaretDown} size={20} />
      </button>
      <YourGroupsSheet
        open={open}
        onOpenChange={setOpen}
        groups={groups}
        focusedId={group.id}
        onPick={setFocus}
      />
    </>
  )
}
