import type { TodayData, TodayItem } from '@/domain/today'
import {
  clearPostMoment,
  getPostMoment,
  markPostMomentAnnounced,
  markPostMomentPlayed,
  setPostMoment,
  withPostMoment,
  type PostMoment,
} from '@/data/post-moment'

const ROW: TodayItem = {
  commitmentId: 'c1',
  kind: 'commitment',
  section: 'due_today',
  presetKey: 'gym',
  customName: null,
  activityName: 'Gym',
  name: null,
  scheduleType: 'times_per_week',
  days: null,
  target: 3,
  counted: 1,
  deadline: null,
  startsOn: null,
  canDelete: false,
  countedToday: false,
  targetMet: false,
}

const DATA: TodayData = {
  items: [ROW, { ...ROW, commitmentId: 'c2' }],
  summary: {
    memberToday: '2026-11-20',
    weekStart: '2026-11-16',
    weekNumber: 1,
    planned: 6,
    done: 1,
    left: 5,
    hasPlan: true,
  },
}

const MOMENT: PostMoment = {
  checkinId: 'k1',
  groupId: 'g1',
  commitmentId: 'c1',
  title: 'Gym',
  doneCount: 3,
  target: 3,
  counted: true,
  photoUrl: null,
  caption: null,
  postedAt: 1000,
  played: false,
  announced: false,
}

describe('withPostMoment', () => {
  it("puts the post's counts on its row while the data is older than the post", () => {
    const next = withPostMoment(DATA, MOMENT, 999)
    expect(next.items[0]).toMatchObject({ counted: 3, countedToday: true, targetMet: true })
    expect(next.items[1]).toBe(DATA.items[1])
  })

  it('drops the override once Today was fetched after the post', () => {
    expect(withPostMoment(DATA, MOMENT, 1001)).toBe(DATA)
  })

  it('changes nothing for an extra, no moment or a row that is gone', () => {
    expect(withPostMoment(DATA, { ...MOMENT, counted: false }, 0)).toBe(DATA)
    expect(withPostMoment(DATA, null, 0)).toBe(DATA)
    expect(withPostMoment(DATA, { ...MOMENT, commitmentId: 'gone' }, 0)).toBe(DATA)
  })
})

describe('post moment store', () => {
  it('marks played and announced once per post, and clears on sign-out', () => {
    setPostMoment(MOMENT)
    markPostMomentPlayed('other')
    expect(getPostMoment()?.played).toBe(false)
    markPostMomentPlayed('k1')
    markPostMomentAnnounced('k1')
    expect(getPostMoment()).toMatchObject({ played: true, announced: true })
    clearPostMoment()
    expect(getPostMoment()).toBeNull()
  })
})
