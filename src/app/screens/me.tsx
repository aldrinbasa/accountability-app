import { Link, useLocation } from 'react-router'
import { CaretRight, GearSix } from '@phosphor-icons/react'
import { Screen } from '@/app/screens/screen'
import type { PushedFromMeState } from '@/app/screens/settings'
import { Icon } from '@/ui/icon'

/** Placeholder until the Me stories (profile, badges, groups). Settings is reachable from here. */
export function MeScreen() {
  const { search, state } = useLocation()
  // Keep what sits behind Me (the Today entry) so tab navigation still works from Settings.
  const pushedState: PushedFromMeState = {
    ...(state && typeof state === 'object' ? state : {}),
    fromMe: true,
  }

  return (
    <Screen title="Me">
      <p className="card type-body">Your profile, badges and settings live here.</p>
      <ul className="card flex flex-col p-0">
        <li>
          <Link
            to={{ pathname: '/me/settings', search }}
            state={pushedState}
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
