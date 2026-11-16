import { Screen } from '@/app/screens/screen'
import { todayHeading } from '@/app/screens/today-heading'

/** Placeholder until the Today stories (score sticker, due rows, friends strip). */
export function TodayScreen() {
  return (
    <Screen title={todayHeading()}>
      <p className="card type-body">Your commitments for today show up here.</p>
    </Screen>
  )
}
