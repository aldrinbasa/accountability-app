import { useState } from 'react'
import { Check, PlusSquare } from '@phosphor-icons/react'
import {
  GROUP_COPY,
  isWaiting,
  memberCountText,
  ROLE_LABEL,
  sortByJoined,
  type MyGroup,
} from '@/domain/groups'
import { Icon } from '@/ui/icon'
import { Sheet } from '@/ui/sheet'
import { runAfterSheetClose } from '@/ui/sheet-history'
import { CreateGroupForm } from '@/features/group/create-group-form'
import { GroupDot } from '@/features/group/group-dot'
import { useOpenGroupOnToday } from '@/features/group/use-focused-group'

export interface YourGroupsSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  groups: readonly MyGroup[]
  focusedId: string
  /** Refocus on another group (replaces `?g=`). Runs after the sheet's history entry is gone. */
  onPick: (groupId: string) => void
}

const ROW =
  'flex min-h-row-min w-full items-center gap-3 border-b-[1.5px] border-line/18 px-1 text-left text-ink press-overlay last:border-b-0'

/**
 * "Your groups": the current groups with role and member count, the focused one checked, and
 * "Create or join a group" last, which turns the sheet into the same create form as Today's.
 * Navigation waits for the sheet's history entry to go, so system back still means "back".
 */
export function YourGroupsSheet({
  open,
  onOpenChange,
  groups,
  focusedId,
  onPick,
}: YourGroupsSheetProps) {
  const [mode, setMode] = useState<'list' | 'create'>('list')
  const [dirty, setDirty] = useState(false)
  const openGroup = useOpenGroupOnToday()

  function setOpen(next: boolean) {
    if (!next) {
      setMode('list')
      setDirty(false)
    }
    onOpenChange(next)
  }

  function pick(groupId: string) {
    setOpen(false)
    if (groupId !== focusedId) runAfterSheetClose(() => onPick(groupId))
  }

  function created(groupId: string) {
    setOpen(false)
    runAfterSheetClose(() => openGroup(groupId))
  }

  return (
    <Sheet
      open={open}
      onOpenChange={setOpen}
      title={mode === 'list' ? GROUP_COPY.switcherSheetTitle : GROUP_COPY.createHeading}
      dirty={mode === 'create' && dirty}
    >
      {mode === 'list' ? (
        <ul className="flex flex-col">
          {sortByJoined(groups).map((group) => {
            const focused = group.id === focusedId
            return (
              <li key={group.id}>
                <button
                  type="button"
                  aria-current={focused || undefined}
                  onClick={() => pick(group.id)}
                  className={ROW}
                >
                  <GroupDot waiting={isWaiting(group)} />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate type-body-strong">{group.name}</span>
                    <span className="type-meta text-muted">
                      {ROLE_LABEL[group.role]} · {memberCountText(group)}
                    </span>
                  </span>
                  {focused ? <Icon icon={Check} size={24} className="text-success" /> : null}
                </button>
              </li>
            )
          })}
          <li>
            <button type="button" onClick={() => setMode('create')} className={ROW}>
              <Icon icon={PlusSquare} size={24} />
              <span className="flex-1 type-body-strong">{GROUP_COPY.createOrJoin}</span>
            </button>
          </li>
        </ul>
      ) : (
        <div className="flex flex-col gap-3 pb-2">
          <p className="type-body-sm text-muted">{GROUP_COPY.createLine}</p>
          <CreateGroupForm onCreated={created} onDirtyChange={setDirty} focusOnMount />
        </div>
      )}
    </Sheet>
  )
}
