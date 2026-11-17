import { Screen } from '@/app/screens/screen'
import { todayHeading } from '@/app/screens/today-heading'
import { InstallNotice } from '@/features/install/install-notice'

/** Placeholder until the Today stories (score sticker, due rows, friends strip). */
export function TodayScreen() {
  return (
    <Screen title={todayHeading()}>
      <InstallNotice />
      <p className="card type-body">Your commitments for today show up here.</p>
    </Screen>
  )
}
