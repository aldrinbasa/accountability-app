import { Link, useLocation } from 'react-router'
import { CaretRight, GearSix, ListChecks } from '@phosphor-icons/react'
import { Screen } from '@/app/screens/screen'
import { GROUP_COPY } from '@/domain/groups'
import { MY_PLAN_COPY } from '@/domain/my-plan'
import { useMyGroups } from '@/data/groups'
import { useMyProfile } from '@/data/profile'
import { Icon } from '@/ui/icon'
import { InlineRetry } from '@/ui/inline-retry'
import { MyGroupsList } from '@/features/me/my-groups-list'
import { pushedFromMeState } from '@/features/me/pushed-from-me'

/**
 * Me: the display name, My groups, My plan (the focused group's, Story 2.6) and Settings. Profile
 * details, badges and streaks arrive in Epic 4.
 */
export function MeScreen() {
  const { search, state } = useLocation()
  const { data: profile } = useMyProfile()
  const groupsQuery = useMyGroups()
  const groups = groupsQuery.data

  return (
    <Screen title="Me">
      {profile ? <p className="-mt-1 type-title">{profile.displayName}</p> : null}
      {groups ? <MyGroupsList groups={groups} /> : null}
      {!groups && groupsQuery.isError ? (
        <InlineRetry onRetry={() => void groupsQuery.refetch()} retryLabel={GROUP_COPY.retry}>
          {GROUP_COPY.myGroupsFailed}
        </InlineRetry>
      ) : null}
      <ul className="card flex flex-col p-0">
        <li>
          <Link
            to={{ pathname: '/me/plan', search }}
            state={pushedFromMeState(state)}
            className="flex min-h-row-min w-full items-center gap-3 rounded-wob px-3 text-ink type-body press-overlay"
          >
            <Icon icon={ListChecks} size={24} />
            <span className="flex-1">{MY_PLAN_COPY.title}</span>
            <Icon icon={CaretRight} size={20} />
          </Link>
        </li>
        <li>
          <Link
            to={{ pathname: '/me/settings', search }}
            state={pushedFromMeState(state)}
            className="flex min-h-row-min w-full items-center gap-3 rounded-wob px-3 text-ink type-body press-overlay"
          >
            <Icon icon={GearSix} size={24} />
            <span className="flex-1">Settings</span>
            <Icon icon={CaretRight} size={20} />
          </Link>
        </li>
      </ul>
    </Screen>
  )
}
