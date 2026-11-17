import { Link, useLocation } from 'react-router'
import { CaretRight } from '@phosphor-icons/react'
import {
  GROUP_COPY,
  memberCapacityText,
  ROLE_LABEL,
  sortByJoined,
  type MyGroup,
} from '@/domain/groups'
import { Icon } from '@/ui/icon'
import { RoleChip } from '@/ui/role-chip'
import { pushedFromMeState } from '@/features/me/pushed-from-me'

/**
 * Me > My groups: each current group with its Role chip and "{n} of 10 members" (or "waiting for a
 * 2nd member"); each row opens `/me/groups/{groupId}`, keeping `?g=`. Nothing shows with no groups.
 */
export function MyGroupsList({ groups }: { groups: readonly MyGroup[] }) {
  const { search, state } = useLocation()
  if (groups.length === 0) return null

  return (
    <section aria-labelledby="my-groups-heading" className="flex flex-col gap-2">
      <h2 id="my-groups-heading" className="type-title">
        {GROUP_COPY.myGroups}
      </h2>
      <ul className="card flex flex-col p-0">
        {sortByJoined(groups).map((group) => (
          <li key={group.id} className="border-b-[1.5px] border-line/18 last:border-b-0">
            <Link
              to={{ pathname: `/me/groups/${group.id}`, search }}
              state={pushedFromMeState(state)}
              className="flex min-h-row-min w-full items-center gap-3 rounded-wob px-3 text-ink press-overlay"
            >
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate type-body-strong">{group.name}</span>
                <span className="type-meta text-muted">{memberCapacityText(group)}</span>
              </span>
              <RoleChip variant={group.role}>{ROLE_LABEL[group.role]}</RoleChip>
              <Icon icon={CaretRight} size={20} />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}
